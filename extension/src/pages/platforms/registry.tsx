/**
 * Platform-specific UI extensions. The platform page renders generic Accounts / Tasks / Schedules
 * tabs for every platform; a platform can add its own tabs, reorder them, replace a generic tab
 * (same id) and add per-task actions here. Adding a new platform's UI means adding one entry —
 * nothing else in the app changes.
 */
import type { ComponentType } from 'react';
import type { PlatformDescriptor, Task } from '@shared/types/index';
import type { IconName } from '../../components/icons';
import { naukriExtension } from './naukri';
import { linkedinExtension } from './linkedin';

export interface PlatformTab {
  id: string;
  label: string;
  icon: IconName;
  component: ComponentType<{ platform: PlatformDescriptor }>;
}

export interface PlatformExtension {
  tabs?: PlatformTab[];
  /**
   * Full tab order, mixing generic ids ('accounts' | 'tasks' | 'schedules') and the platform's own
   * tab ids. An own tab with a generic id replaces the generic one. Default order:
   * accounts, tasks, own tabs…, schedules.
   */
  tabOrder?: string[];
  /** Extra buttons on a task card (e.g. Naukri's "Re-learn baseline"). */
  taskActions?: ComponentType<{ task: Task }>;
  /** Tab id where items prepared by a run wait for review (e.g. LinkedIn's connection drafts). */
  reviewTab?: string;
  /** Replaces the generic "Configure" button of multi-instance tasks (e.g. opens the LinkedIn wizard). */
  editTask?: (task: Task) => void;
}

export const platformExtensions: Record<string, PlatformExtension> = {
  naukri: naukriExtension,
  linkedin: linkedinExtension,
};

/** Hash route to the review screen of a platform, if it has one. */
export function reviewHref(platformId: string, taskId?: string | null): string | null {
  const tab = platformExtensions[platformId]?.reviewTab;
  if (!tab) return null;
  return `#/platforms/${encodeURIComponent(platformId)}/${tab}${taskId ? `?task=${encodeURIComponent(taskId)}` : ''}`;
}
