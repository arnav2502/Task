import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Entry } from '@napi-rs/keyring';
import type { CredentialBackend } from '@shared/types/index.js';
import { appLogger } from '../logging/logger.js';

/**
 * Secret storage for account passwords.
 *
 * Primary backend: the OS credential store (Windows Credential Manager, macOS Keychain, libsecret)
 * via @napi-rs/keyring. Fallback: an AES-256-GCM vault file (DATA_DIR/secrets/vault.json) whose key
 * lives in a separate file (master.key) or CREDENTIAL_KEY — never next to the ciphertext.
 *
 * The database only stores a reference such as "keyring:naukri:<accountId>". Passwords are never
 * written to the DB, the extension, extension storage, localStorage or any log.
 */
export interface SecretStore {
  readonly backend: CredentialBackend;
  set(id: string, secret: string): Promise<string>;
  get(ref: string): Promise<string | null>;
  delete(ref: string): Promise<void>;
}

const refId = (ref: string) => {
  const i = ref.indexOf(':');
  return i === -1 ? ref : ref.slice(i + 1);
};

class KeyringStore implements SecretStore {
  readonly backend = 'keyring' as const;
  constructor(private readonly service: string) {}

  async set(id: string, secret: string) {
    new Entry(this.service, id).setPassword(secret);
    return `keyring:${id}`;
  }
  async get(ref: string) {
    return new Entry(this.service, refId(ref)).getPassword() ?? null;
  }
  async delete(ref: string) {
    try {
      new Entry(this.service, refId(ref)).deleteCredential();
    } catch {
      /* already gone */
    }
  }
}

interface VaultFile {
  version: 1;
  entries: Record<string, { iv: string; tag: string; data: string }>;
}

function decodeKey(b64: string): Buffer {
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('CREDENTIAL_KEY must be 32 bytes, base64-encoded');
  return key;
}

function loadOrCreateKey(file: string): Buffer {
  if (fs.existsSync(file)) return decodeKey(fs.readFileSync(file, 'utf8').trim());
  const key = crypto.randomBytes(32);
  fs.writeFileSync(file, key.toString('base64'), { mode: 0o600 });
  return key;
}

export class EncryptedVaultStore implements SecretStore {
  readonly backend = 'vault' as const;
  private readonly key: Buffer;
  readonly vaultPath: string;

  constructor(secretsDir: string, keyFromEnv?: string) {
    fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
    this.vaultPath = path.join(secretsDir, 'vault.json');
    this.key = keyFromEnv ? decodeKey(keyFromEnv) : loadOrCreateKey(path.join(secretsDir, 'master.key'));
  }

  private read(): VaultFile {
    if (!fs.existsSync(this.vaultPath)) return { version: 1, entries: {} };
    return JSON.parse(fs.readFileSync(this.vaultPath, 'utf8')) as VaultFile;
  }

  private write(v: VaultFile) {
    const tmp = `${this.vaultPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(v, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.vaultPath);
  }

  async set(id: string, secret: string) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(id));
    const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const v = this.read();
    v.entries[id] = { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
    this.write(v);
    return `vault:${id}`;
  }

  async get(ref: string) {
    const id = refId(ref);
    const e = this.read().entries[id];
    if (!e) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(e.iv, 'base64'));
    decipher.setAAD(Buffer.from(id));
    decipher.setAuthTag(Buffer.from(e.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(e.data, 'base64')), decipher.final()]).toString('utf8');
  }

  async delete(ref: string) {
    const v = this.read();
    delete v.entries[refId(ref)];
    this.write(v);
  }
}

/** Routes each reference to the backend that created it and writes new secrets to the preferred one. */
export class CredentialManager {
  private constructor(
    private readonly preferred: SecretStore,
    private readonly stores: Record<CredentialBackend, SecretStore | null>,
  ) {}

  get backend(): CredentialBackend {
    return this.preferred.backend;
  }

  static async create(opts: { dataDir: string; keyringService: string; credentialKey?: string; forceVault?: boolean }) {
    const vault = new EncryptedVaultStore(path.join(opts.dataDir, 'secrets'), opts.credentialKey);
    let keyring: KeyringStore | null = null;
    let keyringWorks = false;
    if (!opts.forceVault) {
      keyring = new KeyringStore(opts.keyringService);
      // Unique probe per process: two starters racing after a wake-up must not trip over each other.
      const probe = `__probe__${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
      let lastErr = '';
      for (let attempt = 1; attempt <= 3 && !keyringWorks; attempt++) {
        try {
          const ref = await keyring.set(probe, 'ok');
          if ((await keyring.get(ref)) !== 'ok') throw new Error('read-back mismatch');
          await keyring.delete(ref);
          keyringWorks = true;
        } catch (err) {
          lastErr = (err as Error).message;
          if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
        }
      }
      if (!keyringWorks) appLogger.warn(`OS keychain unavailable (${lastErr}); new passwords go to the encrypted local vault`);
    }
    // Existing "keyring:" secrets stay readable even if the start-up probe failed.
    return new CredentialManager(keyringWorks && keyring ? keyring : vault, { keyring, vault });
  }

  /** Store a secret; returns the reference to keep in the database. */
  async save(platformId: string, accountId: string, secret: string): Promise<{ backend: CredentialBackend; reference: string }> {
    const reference = await this.preferred.set(`${platformId}:${accountId}`, secret);
    return { backend: this.preferred.backend, reference };
  }

  async read(reference: string): Promise<string | null> {
    return this.storeFor(reference).get(reference);
  }

  async remove(reference: string): Promise<void> {
    await this.storeFor(reference).delete(reference);
  }

  private storeFor(reference: string): SecretStore {
    const kind = reference.split(':')[0] as CredentialBackend;
    const store = this.stores[kind];
    if (!store) throw new Error(`Credential backend "${kind}" is not available on this machine`);
    return store;
  }
}
