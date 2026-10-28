/**
 * Forget the paired Chrome extension and rotate the API token. Run with the service stopped:
 *   npm run pair:reset
 * The next extension that opens TaskPilot pairs again.
 */
import path from 'node:path';
import { AppDatabase } from '../src/database/database.js';
import { loadConfig } from '../src/config.js';

const config = loadConfig();
const db = new AppDatabase(path.join(config.dataDir, 'taskpilot.sqlite'));
db.settings.deleteKv('pairedExtensionId');
db.settings.deleteKv('apiToken');
db.close();
console.log('Pairing reset. Restart the service, then open TaskPilot in Chrome to pair again.');
