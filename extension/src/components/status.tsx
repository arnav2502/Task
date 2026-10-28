/** Status pills and platform marks — colour is always paired with text. */
import type { AccountStatus, NotificationType, PlatformDescriptor, RunStatus, TaskEffect, TaskLiveStatus, TaskState } from '@shared/types/index';
import { Badge, type Tone } from './ui';
import type { IconName } from './icons';
import { cx } from '../utils/format';

const RUN: Record<TaskLiveStatus | RunStatus, { tone: Tone; label: string; pulse?: boolean }> = {
  idle: { tone: 'slate', label: 'Idle' },
  queued: { tone: 'blue', label: 'Queued', pulse: true },
  running: { tone: 'indigo', label: 'Running', pulse: true },
  success: { tone: 'green', label: 'Success' },
  waiting_for_review: { tone: 'amber', label: 'Waiting for review' },
  failed: { tone: 'red', label: 'Failed' },
  action_required: { tone: 'amber', label: 'Action required' },
  cancelled: { tone: 'slate', label: 'Cancelled' },
  skipped: { tone: 'slate', label: 'Skipped' },
};

export function RunStatusPill({ status }: { status: TaskLiveStatus | RunStatus }) {
  const s = RUN[status];
  return (
    <Badge tone={s.tone} dot pulse={s.pulse}>
      {s.label}
    </Badge>
  );
}

const TASK_STATE: Record<TaskState, { tone: Tone; label: string; pulse?: boolean }> = {
  DRAFT: { tone: 'slate', label: 'Draft' },
  SCHEDULED: { tone: 'blue', label: 'Scheduled' },
  RUNNING: { tone: 'indigo', label: 'Running', pulse: true },
  WAITING_FOR_REVIEW: { tone: 'amber', label: 'Waiting for review' },
  COMPLETED: { tone: 'green', label: 'Completed' },
  FAILED: { tone: 'red', label: 'Failed' },
  CANCELLED: { tone: 'slate', label: 'Cancelled' },
};

/** Lifecycle state of a task instance (DRAFT … COMPLETED). */
export function TaskStateBadge({ state }: { state: TaskState }) {
  const s = TASK_STATE[state] ?? TASK_STATE.DRAFT;
  return (
    <Badge tone={s.tone} dot pulse={s.pulse}>
      {s.label}
    </Badge>
  );
}

const ACCOUNT: Record<AccountStatus, { tone: Tone; label: string }> = {
  unknown: { tone: 'slate', label: 'Not checked' },
  connected: { tone: 'green', label: 'Connected' },
  disconnected: { tone: 'slate', label: 'Disconnected' },
  auth_required: { tone: 'amber', label: 'Sign-in required' },
  login_failed: { tone: 'red', label: 'Login failed' },
  action_required: { tone: 'amber', label: 'Action required' },
  blocked: { tone: 'red', label: 'Blocked' },
};

export function AccountStatusPill({ status }: { status: AccountStatus }) {
  const s = ACCOUNT[status];
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}

export function EffectBadge({ effect }: { effect: TaskEffect }) {
  if (effect === 'apply')
    return (
      <Badge tone="amber" className="uppercase tracking-wide">
        Applies
      </Badge>
    );
  if (effect === 'update') return <Badge tone="violet">Updates profile</Badge>;
  return <Badge tone="cyan">Read-only</Badge>;
}

export const NOTIFICATION_STYLE: Record<NotificationType, { tone: Tone; icon: IconName; label: string; text: string; bg: string }> = {
  SUCCESS: { tone: 'green', icon: 'checkCircle', label: 'Success', text: 'text-emerald-300', bg: 'bg-emerald-500/10' },
  WARNING: { tone: 'amber', icon: 'alert', label: 'Warning', text: 'text-amber-300', bg: 'bg-amber-500/10' },
  ERROR: { tone: 'red', icon: 'xCircle', label: 'Error', text: 'text-rose-300', bg: 'bg-rose-500/10' },
  INFO: { tone: 'blue', icon: 'info', label: 'Info', text: 'text-sky-300', bg: 'bg-sky-500/10' },
  ACTION_REQUIRED: { tone: 'amber', icon: 'hand', label: 'Action required', text: 'text-amber-300', bg: 'bg-amber-500/15' },
};

/** Monogram tile in the platform's accent colour. No third-party logos. */
/**
 * Official platform logos (extension/public/logos). Platforms without a brand (Career Portals,
 * Custom Tasks) — or added later without a logo file — fall back to the accent monogram tile.
 */
const PLATFORM_LOGOS: Record<string, string> = {
  naukri: 'logos/naukri.png',
  linkedin: 'logos/linkedin.svg',
  indeed: 'logos/indeed.svg',
  glassdoor: 'logos/glassdoor.svg',
};

type MarkPlatform = Pick<PlatformDescriptor, 'monogram' | 'accent' | 'name'> & { id?: string; platformId?: string };

export function PlatformMark({
  platform,
  size = 'md',
  muted,
}: {
  platform: MarkPlatform | undefined;
  size?: 'sm' | 'md' | 'lg';
  muted?: boolean;
}) {
  const dims = size === 'sm' ? 'h-6 w-6 text-[10px] rounded-md' : size === 'lg' ? 'h-12 w-12 text-base rounded-xl' : 'h-9 w-9 text-xs rounded-lg';
  const pad = size === 'sm' ? 'p-[3px]' : size === 'lg' ? 'p-2' : 'p-1.5';
  const accent = platform?.accent ?? '#64748B';
  const logo = PLATFORM_LOGOS[platform?.id ?? platform?.platformId ?? ''];
  if (logo) {
    return (
      <span
        aria-hidden="true"
        className={cx('inline-flex shrink-0 items-center justify-center bg-snow ring-1 ring-white/10', dims, pad, muted && 'opacity-80')}
        style={{ boxShadow: `0 6px 18px -8px ${accent}` }}
      >
        <img src={logo} alt="" className="h-full w-full object-contain" draggable={false} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cx('inline-flex shrink-0 items-center justify-center font-bold text-snow', dims, muted && 'opacity-50 grayscale')}
      style={{ background: `linear-gradient(135deg, ${accent}, ${accent}B3)`, boxShadow: `0 6px 18px -8px ${accent}` }}
    >
      {platform?.monogram ?? '?'}
    </span>
  );
}

export function PlatformTag({ platform }: { platform: MarkPlatform | undefined }) {
  return (
    <span className="inline-flex items-center gap-2">
      <PlatformMark platform={platform} size="sm" />
      <span className="text-slate-200">{platform?.name ?? 'Unknown'}</span>
    </span>
  );
}
