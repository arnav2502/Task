import { Router, type Request } from 'express';
import { z } from 'zod';
import { LEAD_STATUSES, LINKEDIN_ACTIONS, LINKEDIN_NOTE_MAX, type LeadStatus } from '@shared/types/linkedin.js';
import type { AppDatabase } from '../../database/database.js';
import { conflict, notFound } from '../../errors/automationError.js';
import type { ActionRequest } from '../base/platformAdapter.js';
import type { LinkedInStore } from './store.js';

const note = z
  .string()
  .max(LINKEDIN_NOTE_MAX, `A LinkedIn note can be at most ${LINKEDIN_NOTE_MAX} characters`)
  .nullable()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : null));
const draftBody = z.object({ note });
/** The literal `confirm: true` documents that a person pressed "Confirm & Send" for this one lead. */
const confirmBody = z.object({ confirm: z.literal(true, { message: 'Sending needs your explicit confirmation' }), note });
const bulkBody = z.object({ ids: z.array(z.number().int()).min(1).max(500), action: z.enum(['review', 'select', 'skip']) });
const leadQuery = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  taskId: z.string().optional(),
  accountId: z.string().optional(),
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/** Leads that can no longer be acted on. */
const DONE: LeadStatus[] = ['CONNECTION_SENT', 'CONNECTED'];

const qs = (req: Request, k: string) => (typeof req.query[k] === 'string' && req.query[k] ? (req.query[k] as string) : undefined);

/** LinkedIn routes, mounted at /platforms/linkedin (behind the same auth as every route). */
export function linkedinRoutes(opts: { db: AppDatabase; store: LinkedInStore; runAction: (req: ActionRequest) => { id: string } }): Router {
  const { db, store, runAction } = opts;
  const r = Router();
  const leadOr404 = (req: Request) => {
    const lead = store.lead(Number(req.params.id));
    if (!lead) throw notFound('Lead');
    return lead;
  };
  const startOfToday = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  };

  r.get('/stats', (req, res) => res.json(store.stats(qs(req, 'accountId') ?? null, startOfToday())));

  r.get('/tasks', (_req, res) => {
    const ids = db.tasks.list({ platformId: 'linkedin' }).map((t) => t.id);
    res.json(store.taskStats(ids));
  });
  r.get('/tasks/:taskId', (req, res) => {
    const task = db.tasks.get(String(req.params.taskId));
    if (!task || task.platformId !== 'linkedin') throw notFound('LinkedIn task');
    res.json({ ...store.taskStats([task.id])[0], searches: store.searches({ taskId: task.id, limit: 20 }) });
  });
  r.get('/searches', (req, res) => res.json(store.searches({ taskId: qs(req, 'taskId'), limit: Math.min(Number(qs(req, 'limit')) || 50, 200) })));

  r.get('/leads', (req, res) => res.json(store.listLeads(leadQuery.parse(req.query))));
  r.get('/leads/:id', (req, res) => {
    const lead = leadOr404(req);
    res.json({ ...lead, draft: store.activeDraft(lead.id) ?? store.latestDraft(lead.id), actions: store.actions(lead.id) });
  });

  r.post('/leads/:id/review', (req, res) => {
    const lead = leadOr404(req);
    res.json(lead.status === 'NEW' ? store.setStatus(lead.id, 'REVIEWED', 'REVIEWED', 'Opened by you') : (store.logAction(lead.id, 'REVIEWED', 'Opened by you', null), lead));
  });
  r.post('/leads/:id/select', (req, res) => {
    const lead = leadOr404(req);
    if (DONE.includes(lead.status)) throw conflict(`${lead.name} is already ${lead.status === 'CONNECTED' ? 'a connection' : 'invited'}`);
    res.json(store.setStatus(lead.id, 'SELECTED', 'SELECTED', 'Selected by you'));
  });
  r.post('/leads/:id/skip', (req, res) => {
    const lead = leadOr404(req);
    if (lead.status === 'CONNECTION_CONFIRMED') throw conflict('This request is being sent — wait for it to finish');
    const draft = store.activeDraft(lead.id);
    if (draft) store.setDraftStatus(draft.id, 'skipped');
    res.json(DONE.includes(lead.status) ? lead : store.setStatus(lead.id, 'SKIPPED', 'SKIPPED', 'Skipped by you'));
  });
  r.post('/leads/bulk', (req, res) => {
    const { ids, action } = bulkBody.parse(req.body);
    let updated = 0;
    for (const id of ids) {
      const lead = store.lead(id);
      if (!lead || DONE.includes(lead.status) || lead.status === 'CONNECTION_CONFIRMED') continue;
      if (action === 'review') {
        if (lead.status === 'NEW') store.setStatus(id, 'REVIEWED', 'REVIEWED', 'Marked reviewed');
      } else if (action === 'select') {
        store.setStatus(id, 'SELECTED', 'SELECTED', 'Selected by you');
      } else {
        const draft = store.activeDraft(id);
        if (draft) store.setDraftStatus(draft.id, 'skipped');
        store.setStatus(id, 'SKIPPED', 'SKIPPED', 'Skipped by you');
      }
      updated++;
    }
    res.json({ updated });
  });

  /** Prepare or edit the connection draft of one lead (nothing is sent). */
  r.post('/leads/:id/connection-draft', (req, res) => {
    const lead = leadOr404(req);
    if (DONE.includes(lead.status)) throw conflict(`${lead.name} is already ${lead.status === 'CONNECTED' ? 'a connection' : 'invited'}`);
    if (lead.connectionDegree === '1st') throw conflict(`${lead.name} is already a 1st-degree connection`);
    const { note: text } = draftBody.parse(req.body ?? {});
    const existing = store.activeDraft(lead.id);
    if (existing?.status === 'confirmed') throw conflict('This request is being sent — wait for it to finish');
    const draft = store.saveDraft(lead.id, existing?.taskId ?? lead.taskId, text);
    store.setStatus(lead.id, 'READY_FOR_CONNECTION', existing ? 'NOTE_EDITED' : 'PREPARED', text ? 'Note edited by you' : 'No note');
    res.json(store.draft(draft.id));
  });

  /**
   * The ONLY way a connection request is sent: a person pressed "Confirm & Send" for this one lead.
   * Queues a SEND_CONNECTION action run (manual trigger) and returns it.
   */
  r.post('/leads/:id/confirm-connection', (req, res) => {
    const lead = leadOr404(req);
    const { note: text } = confirmBody.parse(req.body ?? {});
    if (DONE.includes(lead.status)) throw conflict(`${lead.name} is already ${lead.status === 'CONNECTED' ? 'a connection' : 'invited'}`);
    if (lead.connectionDegree === '1st') throw conflict(`${lead.name} is already a 1st-degree connection`);
    const existing = store.activeDraft(lead.id);
    const draft = existing ?? store.saveDraft(lead.id, lead.taskId, text);
    const previous = lead.status;
    store.setDraftStatus(draft.id, 'confirmed', { note: text, error: null });
    store.setStatus(lead.id, 'CONNECTION_CONFIRMED', 'CONFIRMED', text ? 'You confirmed sending with a note' : 'You confirmed sending without a note');
    try {
      const run = runAction({ accountId: lead.accountId, action: LINKEDIN_ACTIONS.SEND_CONNECTION, payload: { leadId: lead.id }, key: String(lead.id) });
      store.logAction(lead.id, 'QUEUED', `Run ${run.id}`, run.id);
      res.status(202).json(run);
    } catch (err) {
      // Could not queue (e.g. this lead is already being sent): put things back as they were.
      if (existing?.status !== 'confirmed') {
        store.setDraftStatus(draft.id, 'pending', { note: text });
        store.setStatus(lead.id, previous === 'CONNECTION_CONFIRMED' ? 'READY_FOR_CONNECTION' : previous, 'CONFIRM_FAILED', (err as Error).message);
      }
      throw err;
    }
  });

  r.get('/connection-drafts', (req, res) => {
    const status = z.enum(['pending', 'confirmed', 'sent', 'skipped', 'failed']).optional().parse(qs(req, 'status'));
    res.json(store.listDrafts({ status, taskId: qs(req, 'taskId'), accountId: qs(req, 'accountId') }));
  });

  return r;
}
