import type http from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';
import { APP_NAME, APP_VERSION } from '@shared/constants/index.js';
import type { HealthResponse, LiveMessage } from '@shared/types/index.js';
import type { Services } from '../container.js';
import { AutomationError, HttpError } from '../errors/automationError.js';
import { appLogger } from '../logging/logger.js';
import { genericRoutes } from './routes.js';
import { bearerAuth, extensionIdFromOrigin, getOrCreateToken, hostAndOriginGuard, pairHandler, tokensEqual, validHost } from './security.js';

export function createApp(s: Services) {
  const token = getOrCreateToken(s.db);
  const started = Date.now();
  const app = express();
  app.disable('x-powered-by');
  app.use(hostAndOriginGuard);
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', (_req, res) => {
    const body: HealthResponse = {
      ok: true,
      name: APP_NAME,
      version: APP_VERSION,
      uptimeSec: Math.round((Date.now() - started) / 1000),
      paired: !!s.db.settings.getKv('pairedExtensionId'),
      credentialBackend: s.credentials.backend,
      platforms: s.registry.list().length,
    };
    res.json(body);
  });
  app.post(
    '/pair',
    pairHandler(s.db, token, s.config.allowedExtensionId, (extId) => {
      appLogger.info(`Paired with extension ${extId}`);
      s.notifications.event('security.paired', `Paired with Chrome extension ${extId}`);
    }),
  );

  // Everything below needs the bearer token.
  app.use(bearerAuth(token));
  app.use(genericRoutes(s));
  for (const adapter of s.registry.available()) {
    const router = adapter.routes?.();
    if (router) app.use(`/platforms/${adapter.platformId}`, router);
  }

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    void _next;
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), code: 'VALIDATION' });
    }
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err instanceof AutomationError) {
      const status = err.category === 'CONFIG_INVALID' ? 400 : err.category === 'PLATFORM_UNAVAILABLE' ? 409 : 500;
      return res.status(status).json({ error: err.message, code: err.code });
    }
    if ((err as { type?: string })?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    appLogger.error(`Unhandled API error: ${(err as Error)?.stack ?? String(err)}`);
    res.status(500).json({ error: 'Internal error' });
  });
  return { app, token };
}

/** Live updates for the extension. Same token as the HTTP API; only extension origins. */
export function attachWebSocket(server: http.Server, s: Services, token: string) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const origin = req.headers.origin;
    const ok =
      url.pathname === '/ws' && validHost(req) && tokensEqual(url.searchParams.get('token') ?? '', token) && (!origin || !!extensionIdFromOrigin(origin));
    if (!ok) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws: WebSocket) => {
    s.scheduler.chromeHeartbeat();
    const unsubscribe = s.bus.subscribe((msg: LiveMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    });
    // Keep-alive so idle connections are not dropped and dead ones are noticed.
    const ping = setInterval(() => ws.readyState === ws.OPEN && ws.ping(), 30_000);
    const close = () => {
      clearInterval(ping);
      unsubscribe();
    };
    ws.on('close', close);
    ws.on('error', close);
  });
  return wss;
}
