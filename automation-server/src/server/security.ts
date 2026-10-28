import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import type { AppDatabase } from '../database/database.js';

const EXTENSION_ORIGIN = /^chrome-extension:\/\/([a-p]{32})$/;

export const extensionIdFromOrigin = (origin: string | undefined) => EXTENSION_ORIGIN.exec(origin ?? '')?.[1] ?? null;

export function getOrCreateToken(db: AppDatabase): string {
  let token = db.settings.getKv('apiToken');
  if (!token) {
    token = crypto.randomBytes(32).toString('base64url');
    db.settings.setKv('apiToken', token);
  }
  return token;
}

export function tokensEqual(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Only 127.0.0.1:<port> / localhost:<port> — blocks DNS-rebinding attacks from web pages. */
export function validHost(req: IncomingMessage): boolean {
  const port = req.socket.localPort;
  return req.headers.host === `127.0.0.1:${port}` || req.headers.host === `localhost:${port}`;
}

/** Host check + CORS restricted to Chrome extensions. Websites can never call the API. */
export function hostAndOriginGuard(req: Request, res: Response, next: NextFunction) {
  if (!validHost(req)) return res.status(403).json({ error: 'Invalid Host header' });
  const origin = req.headers.origin;
  if (origin) {
    if (!extensionIdFromOrigin(origin)) return res.status(403).json({ error: 'Origin not allowed' });
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
}

export function bearerAuth(token: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const given = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!tokensEqual(given, token)) return res.status(401).json({ error: 'Unauthorized — pair the extension first', code: 'UNAUTHORIZED' });
    next();
  };
}

/**
 * Pairing: the first extension that calls /pair is trusted (or the one pinned with
 * TASKPILOT_EXTENSION_ID). Its id is remembered; any other extension is refused.
 */
export function pairHandler(db: AppDatabase, token: string, pinnedId: string | null, onPaired: (extId: string) => void) {
  return (req: Request, res: Response) => {
    const extId = extensionIdFromOrigin(req.headers.origin);
    if (!extId) return res.status(403).json({ error: 'Pairing is only allowed from the TaskPilot Chrome extension' });
    if (pinnedId && pinnedId !== extId) return res.status(403).json({ error: 'This extension is not the one allowed by TASKPILOT_EXTENSION_ID' });
    const paired = db.settings.getKv('pairedExtensionId');
    if (paired && paired !== extId) {
      return res.status(403).json({ error: 'The service is paired with a different extension. Run "npm run pair:reset" in the project folder, then retry.' });
    }
    if (!paired) {
      db.settings.setKv('pairedExtensionId', extId);
      onPaired(extId);
    }
    res.json({ token });
  };
}
