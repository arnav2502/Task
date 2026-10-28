import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NAUKRI_TASKS } from '@shared/types/naukri';
import { maskUsername, toPublicAccount } from '../../automation-server/src/accounts/accountService';
import { EncryptedVaultStore } from '../../automation-server/src/credentials/credentialManager';
import { appLogger, redact } from '../../automation-server/src/logging/logger';
import { addNaukriAccount, createEnv, makeTempDir, type TestEnv } from '../helpers/env';

let env: TestEnv;
afterEach(async () => env?.close());

/** Every file under a folder, as text (binary SQLite pages included). */
function allBytes(dir: string): string {
  let out = '';
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) out += fs.readFileSync(path.join(e.parentPath, e.name)).toString('latin1');
  }
  return out;
}

describe('Accounts', () => {
  it('creates an account with tasks for every task type, an isolated browser profile and stored credentials', async () => {
    env = await createEnv({ mock: false });
    const a = await addNaukriAccount(env, 'Personal Naukri', 'arnav.test@example.com');
    expect(a).toMatchObject({ platformId: 'naukri', status: 'unknown', enabled: true, hasCredentials: true });
    expect(env.services.db.tasks.list({ accountId: a.id }).map((t) => t.taskType).sort()).toEqual(
      [NAUKRI_TASKS.PROFILE_UPDATE, NAUKRI_TASKS.RESUME_UPLOAD, NAUKRI_TASKS.SHARE_INTEREST].sort(),
    );
    const profile = env.services.accounts.profileDir(a);
    expect(profile).toBe(path.join(env.config.dataDir, 'accounts', 'naukri', a.id, 'browser-profile'));
    expect(fs.existsSync(profile)).toBe(true);
    expect(await env.services.accounts.credentials(a.id)).toEqual({ username: 'arnav.test@example.com', password: 'Secret#123' });
  });

  it('isolates browser profiles per account', async () => {
    env = await createEnv({ mock: false });
    const a = await addNaukriAccount(env, 'A', 'a@example.com');
    const b = await addNaukriAccount(env, 'B', 'b@example.com');
    expect(env.services.accounts.profileDir(a)).not.toBe(env.services.accounts.profileDir(b));
  });

  it('refuses coming-soon platforms, unknown platforms and duplicates', async () => {
    env = await createEnv({ mock: false });
    await expect(env.services.accounts.create({ platformId: 'indeed', name: 'L', username: 'l@example.com', password: 'x' })).rejects.toThrow(/coming soon/);
    await expect(env.services.accounts.create({ platformId: 'myspace', name: 'M', username: 'm@example.com', password: 'x' })).rejects.toThrow(/not found/);
    await addNaukriAccount(env, 'A', 'dup@example.com');
    await expect(addNaukriAccount(env, 'B', 'DUP@example.com')).rejects.toThrow(/already exists/);
    await expect(env.services.accounts.create({ platformId: 'naukri', name: 'NoPw', username: 'np@example.com' })).rejects.toThrow(/password is required/i);
  });

  it('masks usernames in everything sent to the extension', () => {
    expect(maskUsername('arnav.test@example.com')).toBe('arna******@example.com');
    expect(maskUsername('ab@x.com')).toBe('****@x.com');
    expect(maskUsername('plainuser')).toMatch(/^pla\*+$/);
  });

  it('keeps the password when updating without one, replaces it when given', async () => {
    env = await createEnv({ mock: false });
    const a = await addNaukriAccount(env, 'A', 'a@example.com');
    await env.services.accounts.update(a.id, { name: 'Renamed', password: '' });
    expect((await env.services.accounts.credentials(a.id))?.password).toBe('Secret#123');
    await env.services.accounts.update(a.id, { password: 'New#Pass1' });
    expect((await env.services.accounts.credentials(a.id))?.password).toBe('New#Pass1');
    expect(env.services.accounts.get(a.id).name).toBe('Renamed');
  });

  it('disconnect clears the browser session but keeps the password', async () => {
    env = await createEnv({ mock: false });
    const a = await addNaukriAccount(env, 'A', 'a@example.com');
    const dir = env.services.accounts.profileDir(a);
    fs.writeFileSync(path.join(dir, 'Cookies'), 'session');
    const after = await env.services.accounts.disconnect(a.id);
    expect(after.status).toBe('disconnected');
    expect(fs.existsSync(path.join(dir, 'Cookies'))).toBe(false);
    expect(await env.services.accounts.credentials(a.id)).not.toBeNull();
  });

  it('delete removes credentials, browser profile, tasks and schedules', async () => {
    env = await createEnv({ mock: false });
    const a = await addNaukriAccount(env, 'A', 'a@example.com');
    const task = env.services.db.tasks.findByType(a.id, NAUKRI_TASKS.PROFILE_UPDATE)!;
    env.services.scheduler.create({ taskId: task.id, frequency: 'daily', time: '09:00' });
    const ref = env.services.db.accounts.credentialRef(a.id)!;
    await env.services.accounts.remove(a.id);
    expect(env.services.db.accounts.get(a.id)).toBeNull();
    expect(env.services.db.tasks.list({ accountId: a.id })).toHaveLength(0);
    expect(env.services.db.schedules.list({ accountId: a.id })).toHaveLength(0);
    expect(await env.services.credentials.read(ref.reference)).toBeNull();
    expect(fs.existsSync(path.join(env.config.dataDir, 'accounts', 'naukri', a.id))).toBe(false);
  });
});

describe('Credential security', () => {
  it('never stores the password in plaintext anywhere on disk', async () => {
    env = await createEnv({ mock: false });
    const secret = 'Pl@intext-Should-Never-Appear-42';
    const a = await env.services.accounts.create({ platformId: 'naukri', name: 'A', username: 'a@example.com', password: secret });
    await env.services.accounts.credentials(a.id); // read it once (registers redaction)
    env.services.db.raw.pragma('wal_checkpoint(TRUNCATE)');
    expect(allBytes(env.dir)).not.toContain(secret);
    expect(env.services.db.accounts.credentialRef(a.id)?.reference).toBe(`vault:naukri:${a.id}`);
    expect(JSON.stringify(toPublicAccount(env.services.accounts.get(a.id)))).not.toContain(secret);
  });

  it('the vault detects tampering (AES-GCM authentication)', async () => {
    const dir = makeTempDir('vault');
    const vault = new EncryptedVaultStore(dir);
    const ref = await vault.set('naukri:1', 'top-secret');
    expect(await vault.get(ref)).toBe('top-secret');
    const file = JSON.parse(fs.readFileSync(vault.vaultPath, 'utf8'));
    const entry = file.entries['naukri:1'];
    entry.data = Buffer.from(Buffer.from(entry.data, 'base64').map((b: number) => b ^ 1)).toString('base64');
    fs.writeFileSync(vault.vaultPath, JSON.stringify(file));
    await expect(vault.get(ref)).rejects.toThrow();
  });

  it('a vault entry cannot be moved to another account id (AAD binding)', async () => {
    const vault = new EncryptedVaultStore(makeTempDir('vault'));
    await vault.set('naukri:a', 'secret-a');
    const file = JSON.parse(fs.readFileSync(vault.vaultPath, 'utf8'));
    file.entries['naukri:b'] = file.entries['naukri:a'];
    fs.writeFileSync(vault.vaultPath, JSON.stringify(file));
    await expect(vault.get('vault:naukri:b')).rejects.toThrow();
  });

  it('passwords read for a login are masked in every log', async () => {
    env = await createEnv({ mock: false });
    const a = await env.services.accounts.create({ platformId: 'naukri', name: 'A', username: 'a@example.com', password: 'Redact-Me-123' });
    await env.services.accounts.credentials(a.id);
    expect(redact('typed Redact-Me-123 into the form')).toBe('typed •••••• into the form');
    appLogger.init(env.config.logsDir);
    appLogger.warn('leak? Redact-Me-123');
    expect(fs.readFileSync(path.join(env.config.logsDir, 'service.log'), 'utf8')).not.toContain('Redact-Me-123');
  });
});
