import { Database } from 'bun:sqlite';
import { PROJECT_ROOT } from '../src/config/index.js';
import path from 'path';

async function main() {
  console.log('=== REAL RUNTIME NOTIFICATION VERIFICATION VIA WEB SERVER ===');
  const now = new Date();
  console.log('Current local time:', now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }));

  // Target 1 minute in the future
  const targetDate = new Date(now.getTime() + 65 * 1000);
  const targetHour = targetDate.getHours() % 12 || 12;
  const targetMin = targetDate.getMinutes();
  const ampm = targetDate.getHours() >= 12 ? 'pm' : 'am';
  const timeStr = `${targetHour}:${targetMin.toString().padStart(2, '0')} ${ampm}`;

  console.log(`Setting reminder for: ${timeStr} (in ~65 seconds)...`);

  const prompt = `set reminder about test real desktop toast notification at ${timeStr}`;
  console.log('Sending to Web API http://localhost:3000/api/chat...');

  const resp = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: prompt }),
  });

  if (!resp.ok) {
    throw new Error(`Web API returned ${resp.status}: ${await resp.text()}`);
  }

  const reader = resp.body?.getReader();
  let fullText = '';
  if (reader) {
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value);
    }
  }

  console.log('Web API Response:', fullText);

  // Verify in root SQLite database
  const dbPath = path.join(PROJECT_ROOT, 'data', 'creater.db');
  console.log('Checking database at:', dbPath);
  const db = new Database(dbPath);

  const scheds = db.prepare("SELECT * FROM schedules WHERE name LIKE '%test real desktop toast notification%' ORDER BY created_at DESC LIMIT 1").all() as any[];
  console.log('Persisted schedule in SQLite:', scheds);

  if (scheds.length === 0) {
    throw new Error('Schedule was not persisted to SQLite!');
  }

  const job = scheds[0];
  console.log(`Schedule ID: ${job.id}, status: ${job.status}, runAt: ${new Date(job.run_at).toISOString()}`);

  const msToWait = Math.max(0, job.run_at - Date.now() + 3000);
  console.log(`Waiting ${(msToWait / 1000).toFixed(1)} seconds for background scheduler loop in Web Server to tick naturally...`);

  await new Promise((resolve) => setTimeout(resolve, msToWait));

  console.log('Checking occurrences table in SQLite after scheduled time has passed...');
  let occs: any[] = [];
  let updatedJob: any = null;

  // Poll for up to 10 seconds for the 1-second tick loop to process the occurrence
  for (let i = 0; i < 10; i++) {
    occs = db.prepare("SELECT * FROM schedule_occurrences WHERE schedule_id = ?").all(job.id) as any[];
    updatedJob = db.prepare("SELECT * FROM schedules WHERE id = ?").get(job.id) as any;
    if (occs.length > 0 && occs[0].status === 'SUCCESS') break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log('Occurrences for job:', occs);
  console.log('Updated schedule status in SQLite:', updatedJob?.status);

  if (occs.length === 1 && occs[0].status === 'SUCCESS') {
    console.log('✅ SUCCESS: Occurrence recorded with status SUCCESS!');
    console.log('Delivered Channel:', occs[0].delivered_channel);
    console.log('Notification Title:', occs[0].notification_title);
    console.log('Notification Body:', occs[0].notification_body);
  } else {
    console.error('❌ FAILURE: Occurrence was not processed successfully:', occs);
  }

  // Cleanup test reminder from DB so user reminders are not polluted
  db.prepare("DELETE FROM schedule_occurrences WHERE schedule_id = ?").run(job.id);
  db.prepare("DELETE FROM schedules WHERE id = ?").run(job.id);
  console.log('Test schedule cleaned up.');
}

main().catch((err) => {
  console.error('Verification error:', err);
  process.exit(1);
});
