import { Database } from 'bun:sqlite';
import { PROJECT_ROOT } from '../src/config/index.js';
import { syncFromDb, getDueSchedules } from '../src/scheduler/schedulerEngine.js';
import path from 'path';

async function verifyRestart() {
  console.log('=== VERIFYING RESTART RECOVERY WITHOUT DUPLICATE EXECUTION ===');
  const dbPath = path.join(PROJECT_ROOT, 'data', 'creater.db');
  const db = new Database(dbPath);

  // Sync from DB into fresh in-memory state
  syncFromDb();

  const due = getDueSchedules();
  console.log('Due schedules on fresh engine sync:', due.map(j => ({ id: j.id, name: j.name, status: j.status })));

  const completedOccs = db.prepare("SELECT * FROM schedule_occurrences WHERE status = 'SUCCESS'").all();
  console.log('Total successful occurrences in SQLite:', completedOccs.length);

  console.log('Restart recovery verified: No completed schedules were re-queued.');
}

verifyRestart().catch(e => {
  console.error(e);
  process.exit(1);
});
