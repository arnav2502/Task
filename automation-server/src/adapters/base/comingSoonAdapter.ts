import { DEFAULT_SETTINGS, type PlatformDescriptor } from '@shared/types/index.js';
import { AutomationError } from '../../errors/automationError.js';
import { BasePlatformAdapter } from './baseAdapter.js';
import type { SessionState, TaskResult } from './platformAdapter.js';

export interface ComingSoonOptions {
  id: string;
  name: string;
  tagline: string;
  description: string;
  accent: string;
  monogram: string;
  website: string | null;
  plannedTasks: string[];
  requiresLogin?: boolean;
  usernameLabel?: string;
  notes?: string[];
}

/**
 * A registered platform that is not implemented yet. It shows up everywhere in the UI with a clear
 * "Coming soon" state, exposes no runnable tasks, refuses accounts, and never pretends to work.
 */
export class ComingSoonAdapter extends BasePlatformAdapter {
  readonly descriptor: PlatformDescriptor;

  constructor(o: ComingSoonOptions) {
    super();
    this.descriptor = {
      id: o.id,
      name: o.name,
      tagline: o.tagline,
      description: o.description,
      status: 'coming_soon',
      accent: o.accent,
      monogram: o.monogram,
      website: o.website,
      capabilities: {
        requiresLogin: o.requiresLogin ?? true,
        browserModes: ['background', 'headed', 'headless'],
        defaultMode: DEFAULT_SETTINGS.defaultMode,
        supportsConnect: o.requiresLogin ?? true,
        supportsValidation: false,
      },
      account: { usernameLabel: o.usernameLabel ?? 'Email', usernamePlaceholder: '', passwordLabel: 'Password' },
      tasks: [],
      plannedTasks: o.plannedTasks,
      notes: o.notes ?? [],
    };
  }

  private unavailable(): never {
    throw new AutomationError('PLATFORM_UNAVAILABLE', `${this.platformName} automation is coming soon and is not available yet.`);
  }

  async checkSession(): Promise<SessionState> {
    return this.unavailable();
  }
  async authenticate(): Promise<{ reused: boolean }> {
    return this.unavailable();
  }
  async executeTask(): Promise<TaskResult> {
    return this.unavailable();
  }
}
