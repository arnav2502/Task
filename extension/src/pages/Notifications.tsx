import { useState } from 'react';
import { api } from '../services/api';
import { useApp, useResource } from '../app/state';
import { useFeedback } from '../app/feedback';
import { navigate } from '../app/router';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Segmented, SkeletonList } from '../components/ui';
import { Icon } from '../components/icons';
import { NOTIFICATION_STYLE, PlatformMark } from '../components/status';
import { cx, formatDateTime, relativeTime } from '../utils/format';

export function NotificationsPage() {
  const { platformById, refreshUnread } = useApp();
  const { fail, confirm, toast } = useFeedback();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const { data, error, loading, reload, setData } = useResource(() => api.notifications({ unreadOnly: filter === 'unread', limit: 200 }), [filter], ['notification']);

  const markRead = async (body: { ids?: number[]; all?: boolean }) => {
    try {
      const r = await api.markRead(body);
      setData((cur) =>
        cur
          ? {
              ...cur,
              unread: r.unread,
              notifications: cur.notifications
                .map((n) => (body.all || body.ids?.includes(n.id) ? { ...n, read: true } : n))
                .filter((n) => filter === 'all' || !n.read),
            }
          : cur,
      );
      void refreshUnread();
    } catch (err) {
      fail(err);
    }
  };

  const clear = async () => {
    if (!(await confirm({ title: 'Clear all notifications?', message: 'This permanently removes every notification. Run history is not affected.', confirmLabel: 'Clear all', danger: true }))) return;
    try {
      await api.clearNotifications();
      toast('success', 'Notifications cleared');
      void reload();
      void refreshUnread();
    } catch (err) {
      fail(err);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Monitoring"
        title="Notifications"
        subtitle="Successes, failures and anything that needs you — from every platform."
        actions={
          <>
            <Segmented
              ariaLabel="Filter notifications"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'unread', label: `Unread${data?.unread ? ` (${data.unread})` : ''}` },
              ]}
            />
            <Button icon="check" onClick={() => void markRead({ all: true })} disabled={!data?.unread}>
              Mark all read
            </Button>
            <Button variant="danger" icon="trash" onClick={() => void clear()} disabled={!data?.notifications.length}>
              Clear all
            </Button>
          </>
        }
      />
      {error && <ErrorBanner message={error} onRetry={() => void reload()} />}
      {loading && !data && <SkeletonList rows={5} />}
      {data && data.notifications.length === 0 && (
        <Card>
          <EmptyState icon="bell" title={filter === 'unread' ? 'All caught up' : 'No notifications'} description="Failures, action-required alerts and (optionally) successes appear here and as Chrome notifications." />
        </Card>
      )}
      {data && data.notifications.length > 0 && (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-white/[0.04]">
            {data.notifications.map((n) => {
              const s = NOTIFICATION_STYLE[n.type];
              const platform = n.platformId ? platformById(n.platformId) : undefined;
              return (
                <li key={n.id} className={cx('flex items-start gap-4 px-5 py-4 transition', !n.read && 'bg-indigo-500/[0.04]')}>
                  <span className={cx('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', s.bg, s.text)}>
                    <Icon name={s.icon} size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cx('text-sm', n.read ? 'text-slate-200' : 'font-semibold text-white')}>{n.title}</span>
                      <Badge tone={s.tone}>{s.label}</Badge>
                      {!n.read && <span className="h-2 w-2 rounded-full bg-indigo-400" aria-label="Unread" />}
                    </div>
                    <p className="mt-0.5 text-sm text-slate-400">{n.message}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      {platform && (
                        <span className="inline-flex items-center gap-1.5">
                          <PlatformMark platform={platform} size="sm" />
                          {platform.name}
                        </span>
                      )}
                      <span title={formatDateTime(n.createdAt)}>{relativeTime(n.createdAt)}</span>
                      {n.runId && (
                        <button
                          type="button"
                          className="font-mono text-indigo-300 hover:underline"
                          onClick={() => {
                            if (!n.read) void markRead({ ids: [n.id] });
                            navigate({ name: 'history', runId: n.runId! });
                          }}
                        >
                          {n.runId}
                        </button>
                      )}
                      {n.link && n.link.startsWith('#/') && (
                        <Button
                          size="sm"
                          variant="primary"
                          icon="arrowRight"
                          onClick={() => {
                            if (!n.read) void markRead({ ids: [n.id] });
                            location.hash = n.link!;
                          }}
                        >
                          Review now
                        </Button>
                      )}
                      {n.type === 'ACTION_REQUIRED' && n.accountId && !n.link && (
                        <a href="#/accounts" className="text-amber-300 hover:underline">
                          Open accounts → Connect
                        </a>
                      )}
                    </div>
                  </div>
                  {!n.read && (
                    <Button size="sm" variant="ghost" icon="check" onClick={() => void markRead({ ids: [n.id] })}>
                      Mark read
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
