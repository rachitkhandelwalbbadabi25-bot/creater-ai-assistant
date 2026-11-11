import { processMessage } from "../src/graph/supervisor.js";
import { getPendingIntent, hasPendingIntent } from "../src/conversation/pendingIntentStore.js";
import { listSchedules, deleteSchedule } from "../src/scheduler/schedulerEngine.js";
import { getDB } from "../src/memory/db.js";

async function runRealRuntimeVerification() {
  console.log("=== STARTING REAL RUNTIME VERIFICATION ===");
  const testChannel = `test-verify-${Date.now()}`;
  const db = getDB() as any;

  // Clean test channel schedules if any
  const initialSchedulesCount = listSchedules().length;
  console.log(`Initial Schedule count: ${initialSchedulesCount}`);

  // ─────────────────────────────────────────────────────────────
  // Turn A: "set a reminder for 9;42 am"
  // ─────────────────────────────────────────────────────────────
  console.log("\n--- Turn A: 'set a reminder for 9;42 am' ---");
  const pendingBeforeA = getPendingIntent(testChannel);
  console.log("Pending state before Turn A:", pendingBeforeA);

  const resA = await processMessage("set a reminder for 9;42 am", testChannel as any);
  console.log("Turn A Response:", resA);

  const pendingAfterA = getPendingIntent(testChannel);
  console.log("Pending state after Turn A:", pendingAfterA);

  const schedulesAfterA = listSchedules();
  console.log("Schedule count after Turn A:", schedulesAfterA.length);

  // Assertions for Turn A
  if (resA !== "What should I remind you about at 9:42 AM?") {
    throw new Error(`Turn A failed: unexpected response: ${resA}`);
  }
  if (!pendingAfterA || pendingAfterA.collectedFields.timeInput !== "9:42 AM") {
    throw new Error(`Turn A failed: pending state timeInput is not 9:42 AM: ${JSON.stringify(pendingAfterA)}`);
  }
  if (schedulesAfterA.length !== initialSchedulesCount) {
    throw new Error(`Turn A failed: DB record count increased: ${schedulesAfterA.length} vs ${initialSchedulesCount}`);
  }
  console.log("Turn A Verification: PASSED");

  // ─────────────────────────────────────────────────────────────
  // Turn B: "to message ojas on whatapp -hello bro"
  // ─────────────────────────────────────────────────────────────
  console.log("\n--- Turn B: 'to message ojas on whatapp -hello bro' ---");
  const pendingBeforeB = getPendingIntent(testChannel);
  console.log("Pending state before Turn B:", pendingBeforeB);

  const resB = await processMessage("to message ojas on whatapp -hello bro", testChannel as any);
  console.log("Turn B Response:", resB);

  const pendingAfterB = getPendingIntent(testChannel);
  console.log("Pending state after Turn B:", pendingAfterB);

  const schedulesAfterB = listSchedules();
  console.log("Schedule count after Turn B:", schedulesAfterB.length);

  // Assertions for Turn B
  if (schedulesAfterB.length !== initialSchedulesCount + 1) {
    throw new Error(`Turn B failed: Expected exactly 1 new schedule, got: ${schedulesAfterB.length}`);
  }
  const createdJob = schedulesAfterB[schedulesAfterB.length - 1]!;
  console.log("Created Schedule:", {
    id: createdJob.id,
    name: createdJob.name,
    metadata: createdJob.metadata,
    nextRunAt: new Date(createdJob.nextRunAt!).toISOString(),
  });

  if (createdJob.metadata?.reminderTitle !== "message Ojas on WhatsApp: hello bro") {
    throw new Error(`Turn B failed: reminderTitle incorrect: ${createdJob.metadata?.reminderTitle}`);
  }
  if (hasPendingIntent(testChannel)) {
    throw new Error("Turn B failed: Pending state was not cleared");
  }
  if (resB.toLowerCase().includes("searching google") || resB.toLowerCase().includes("youtube")) {
    throw new Error(`Turn B failed: Unwanted tool routing: ${resB}`);
  }
  console.log("Turn B Verification: PASSED");

  // ─────────────────────────────────────────────────────────────
  // Turn C: "tell me what was the last reminder"
  // ─────────────────────────────────────────────────────────────
  console.log("\n--- Turn C: 'tell me what was the last reminder' ---");
  const resC = await processMessage("tell me what was the last reminder", testChannel as any);
  console.log("Turn C Response:", resC);

  if (!resC.includes("message Ojas on WhatsApp: hello bro") || !resC.includes("9:42 AM")) {
    throw new Error(`Turn C failed: Response did not identify content or time: ${resC}`);
  }

  // Verify SQLite messages table
  const messages = db.prepare("SELECT * FROM messages WHERE channel = ? ORDER BY created_at ASC").all(testChannel) as any[];
  console.log(`SQLite messages count for ${testChannel}:`, messages.length);
  for (const msg of messages) {
    console.log(`  [${msg.role}] ${msg.content.slice(0, 80)}`);
  }

  // Cleanup created test schedule
  deleteSchedule(createdJob.id);
  console.log("\nCleaned up test schedule:", createdJob.id);
  console.log("=== REAL RUNTIME VERIFICATION SUCCESSFUL ===");
}

runRealRuntimeVerification().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
