import { Database } from 'bun:sqlite';
import fs from 'fs';

for (const p of ['./data/creater.db', './src/web/data/creater.db']) {
  console.log('=== Checking path:', p, 'exists:', fs.existsSync(p));
  if (fs.existsSync(p)) {
    try {
      const db = new Database(p);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      console.log('Tables:', tables.map((t: any) => t.name));
      if (tables.some((t: any) => t.name === 'schedules')) {
        const scheds = db.prepare('SELECT * FROM schedules').all();
        console.log('Schedules count:', scheds.length);
        console.log('Schedules:', scheds);
      }
      if (tables.some((t: any) => t.name === 'schedule_occurrences')) {
        const occs = db.prepare('SELECT * FROM schedule_occurrences').all();
        console.log('Occurrences count:', occs.length);
        console.log('Occurrences:', occs);
      }
      if (tables.some((t: any) => t.name === 'reminders')) {
        const rems = db.prepare('SELECT * FROM reminders').all();
        console.log('Legacy reminders count:', rems.length);
        console.log('Legacy reminders:', rems);
      }
    } catch (e: any) {
      console.error('Error opening', p, e.message);
    }
  }
}
