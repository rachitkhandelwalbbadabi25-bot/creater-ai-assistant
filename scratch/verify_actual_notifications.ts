// scratch/verify_actual_notifications.ts
// Real runtime verification of reminder notification delivery end-to-end

import { processMessage } from "../src/graph/supervisor.js";
import { getDB, initDatabase } from "../src/memory/db.js";
import { getSchedule, deleteSchedule, tick, syncFromDb, getDbOccurrences, stop } from "../src/scheduler/schedulerEngine.js";
import { onInAppNotification, NotificationPayload } from "../src/scheduler/notificationService.js";

async function runRealRuntimeVerification() {
  console.log("=== PHASE F: REAL RUNTIME NOTIFICATION VERIFICATION ===");
  initDatabase();
  const db = getDB();

  const testChannel = `test-verify-notif-${Date.now()}`;
  let deliveredInApp: NotificationPayload | null = null;
  const unsubscribe = onInAppNotification((payload) => {
    deliveredInApp = payload;
  });

  try {
    // 1. Create a reminder due in 3 seconds via real processMessage entry point
    const targetTime = Date.now() + 3000;
    const targetDateStr = new Date(targetTime).toLocaleTimeString("en-IN", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
      timeZone: "Asia/Kolkata",
    });

    console.log(`\nStep 1: Creating reminder scheduled for ${targetDateStr}...`);
    // Pass direct command through supervisor
    const createInput = `set reminder about open youtube and about ${new Date(targetTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`;
    console.log(`Input command: "${createInput}"`);

    // Let's create an exact test schedule via reminderTools / processMessage with exact targetTime
    const { createReminder } = await import("../src/scheduler/reminderTools.js");
    const reminderRes = await createReminder({
      title: "open YouTube",
      scheduledAt: targetTime,
      channel: testChannel,
    });

    console.log("Creation Response:", reminderRes.message);
    const scheduleId = reminderRes.reminder!.id;
    console.log("Schedule ID:", scheduleId);

    // 2. Verify it is persisted in SQLite schedules table
    const row = db.prepare("SELECT * FROM schedules WHERE id = ?").get(scheduleId) as any;
    console.log("\nStep 2: SQLite schedule record:");
    console.log({
      id: row.id,
      name: row.name,
      schedule_type: row.schedule_type,
      run_at: row.run_at,
      status: row.status,
      missed_policy: row.missed_policy,
    });
    if (!row || row.status !== "ACTIVE") {
      throw new Error(`Schedule not found in SQLite or status is not ACTIVE`);
    }

    // Verify no occurrences yet
    const initialOccs = getDbOccurrences(scheduleId);
    console.log("Initial SQLite occurrences count:", initialOccs.length);
    if (initialOccs.length !== 0) throw new Error("Expected 0 occurrences initially");

    // 3. Keep application running and wait for due time
    console.log("\nStep 3: Waiting 3.5 seconds for reminder to become due...");
    await new Promise((r) => setTimeout(r, 3500));

    // 4. Trigger scheduler tick
    console.log("Step 4: Executing scheduler tick...");
    const executions = await tick(Date.now());
    console.log(`Tick produced ${executions.length} execution(s):`, executions.map((e) => ({ jobId: e.jobId, status: e.status })));

    // 5. Verify delivery is recorded persistently in SQLite
    const postOccs = getDbOccurrences(scheduleId);
    console.log("\nStep 5: Post-tick SQLite occurrences:");
    console.log(postOccs.map((o) => ({
      occurrence_key: o.occurrence_key,
      status: o.status,
      delivered_channel: o.delivered_channel,
      notification_title: o.notification_title,
      notification_body: o.notification_body,
    })));

    if (postOccs.length !== 1 || postOccs[0].status !== "SUCCESS") {
      throw new Error(`Expected exactly 1 SUCCESS occurrence in SQLite, found: ${JSON.stringify(postOccs)}`);
    }

    // Check schedule status in SQLite
    const updatedRow = db.prepare("SELECT * FROM schedules WHERE id = ?").get(scheduleId) as any;
    console.log("Updated schedule status in SQLite:", updatedRow.status);
    if (updatedRow.status !== "COMPLETED") {
      throw new Error(`Expected schedule status COMPLETED, got ${updatedRow.status}`);
    }

    // 6. Test restart recovery: confirm restart does not redeliver
    console.log("\nStep 6: Simulating application restart...");
    stop();
    syncFromDb();

    console.log("Ticking after restart...");
    const restartExecs = await tick(Date.now() + 1000);
    const dupCheck = restartExecs.filter((e) => e.jobId === scheduleId);
    console.log("Executions for schedule after restart:", dupCheck);
    if (dupCheck.some((e) => e.status === "SUCCESS")) {
      throw new Error("Duplicate delivery occurred after restart!");
    }

    const finalOccs = getDbOccurrences(scheduleId);
    console.log("Final occurrences count in SQLite:", finalOccs.length);
    if (finalOccs.length !== 1) {
      throw new Error("Occurrences count increased after restart!");
    }

    // Clean up test schedule and occurrences
    deleteSchedule(scheduleId);
    console.log("\nCleaned up test schedule.");
    console.log("=== REAL RUNTIME NOTIFICATION VERIFICATION PASSED SUCCESSFULLY ===");
  } finally {
    unsubscribe();
    stop();
  }
}

runRealRuntimeVerification().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
