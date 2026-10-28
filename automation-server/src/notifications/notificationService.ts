import type { AppNotification } from '@shared/types/index.js';
import type { AppDatabase } from '../database/database.js';
import type { NewNotification } from '../database/repositories/notifications.js';
import type { EventBus } from '../events/eventBus.js';
import { redact } from '../logging/logger.js';

/**
 * Generic notification feed for every platform. Notifications are persisted (Notifications page,
 * polled by the extension's background worker to raise Chrome notifications) and pushed live.
 */
export class NotificationService {
  constructor(
    private readonly db: AppDatabase,
    private readonly bus: EventBus,
  ) {}

  notify(n: NewNotification): AppNotification {
    const notification = this.db.notifications.insert({ ...n, title: redact(n.title), message: redact(n.message) });
    this.bus.publish({ type: 'notification', notification });
    return notification;
  }

  /** Audit trail entry (account added, schedule missed, pairing …). */
  event(type: string, message: string, refs: { platformId?: string | null; accountId?: string | null; runId?: string | null } = {}) {
    return this.db.events.insert({ type, message: redact(message), ...refs });
  }
}
