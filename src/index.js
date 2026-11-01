/**
 * Bootstrap. Kept deliberately thin so the database can be restored from a
 * backup *before* any module opens it — modules like db.js run their queries
 * at import time, so the ordering here is load-bearing.
 *
 * On a host with a real disk this does nothing and start-up is identical.
 */
import { restoreDatabase } from './lib/persist.js';

await restoreDatabase();

const { startBot } = await import('./app.js');
startBot();
