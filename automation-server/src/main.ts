import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { APP_NAME, APP_VERSION } from '@shared/constants/index.js';
import { loadConfig, type AppConfig } from './config.js';
import { createServices } from './container.js';
import { appLogger } from './logging/logger.js';
import { startRetention } from './logging/retention.js';
import { attachWebSocket, createApp } from './server/app.js';

export async function startServer(config: AppConfig = loadConfig()) {
  appLogger.init(config.logsDir);
  const services = await createServices(config);
  const { app, token } = createApp(services);
  const server = http.createServer(app);
  const wss = attachWebSocket(server, services, token);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => resolve());
  });
  services.scheduler.start();
  const stopRetention = startRetention(services.db, config.logsDir);

  appLogger.info(`${APP_NAME} automation service v${APP_VERSION} listening on http://${config.host}:${config.port}`);
  appLogger.info(
    `Platforms: ${services.registry
      .list()
      .map((a) => `${a.platformName}${a.available ? '' : ' (coming soon)'}`)
      .join(', ')}`,
  );
  appLogger.info(`Data: ${config.dataDir} · Logs: ${config.logsDir} · Credentials: ${services.credentials.backend === 'keyring' ? 'OS keychain' : 'encrypted vault'}`);
  if (!services.db.settings.getKv('pairedExtensionId')) appLogger.info('Waiting for the Chrome extension to pair — open TaskPilot in Chrome.');

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    appLogger.info(`${signal} received — shutting down`);
    services.scheduler.stop();
    stopRetention();
    wss.clients.forEach((c) => c.terminate());
    server.close();
    // Give running jobs a moment, then close any browser still open.
    await Promise.race([services.executor.queue.idle(), new Promise((r) => setTimeout(r, 10_000))]);
    await services.browsers.closeAll();
    services.db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  return { server, services, token };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  startServer().catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      appLogger.info('Another TaskPilot service is already running on this port — exiting.');
      process.exit(0);
    }
    appLogger.error(`Failed to start: ${err.stack ?? String(err)}`);
    process.exit(1);
  });
}
