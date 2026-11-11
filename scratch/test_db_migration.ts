import { initDatabase, getDB } from '../src/memory/db.js';
initDatabase();
const db = getDB();
console.log('Tables in root db:', db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t: any) => t.name));
