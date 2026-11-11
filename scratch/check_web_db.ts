import { Database } from 'bun:sqlite';
const db = new Database('./src/web/data/creater.db');
const scheds = db.prepare("SELECT * FROM schedules").all();
console.log('Schedules in src/web/data/creater.db:', scheds);
const occs = db.prepare("SELECT * FROM schedule_occurrences").all();
console.log('Occurrences in src/web/data/creater.db:', occs);
