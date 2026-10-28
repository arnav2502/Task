import type { PlatformAdapter } from './platformAdapter.js';
import { notFound } from '../../errors/automationError.js';

/** Holds every platform adapter. The rest of the service looks platforms up here — never by import. */
export class AdapterRegistry {
  private readonly adapters = new Map<string, PlatformAdapter>();

  register(adapter: PlatformAdapter): this {
    if (this.adapters.has(adapter.platformId)) throw new Error(`Platform "${adapter.platformId}" is already registered`);
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(adapter.platformId)) throw new Error(`Invalid platform id "${adapter.platformId}"`);
    const types = adapter.getTasks().map((t) => t.type);
    if (new Set(types).size !== types.length) throw new Error(`Platform "${adapter.platformId}" declares duplicate task types`);
    this.adapters.set(adapter.platformId, adapter);
    return this;
  }

  get(platformId: string): PlatformAdapter | undefined {
    return this.adapters.get(platformId);
  }

  /** Throws a 404 HttpError for unknown platforms. */
  require(platformId: string): PlatformAdapter {
    const a = this.adapters.get(platformId);
    if (!a) throw notFound(`Platform "${platformId}"`);
    return a;
  }

  list(): PlatformAdapter[] {
    return [...this.adapters.values()];
  }

  available(): PlatformAdapter[] {
    return this.list().filter((a) => a.available);
  }
}
