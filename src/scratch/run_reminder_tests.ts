import { processMessage } from "../graph/supervisor.js";
import { listSchedules, deleteSchedule } from "../scheduler/schedulerEngine.js";
import { parseReminderCommand } from "../graph/commandRouter.js";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${msg}`);
    process.exit(1);
  } else {
    console.log(`✅ PASSED: ${msg}`);
  }
}

async function main() {
  console.log("================================================");
  console.log("=== REMINDER SYSTEM VERIFICATION TEST SUITE ===");
  console.log("================================================\n");

  // Reset database before test
  listSchedules().forEach((job) => deleteSchedule(job.id));

  // 1. Missing Information
  console.log("--- 1. Missing Information ---");
  const r1 = await processMessage("can you set a reminder", "tui");
  assert(r1.toLowerCase().includes("what should i remind you about"), "can you set a reminder -> Ask missing content/time");
  assert(listSchedules().length === 0, "No database insertion for 'can you set a reminder'");

  const r2 = await processMessage("set a reminder", "tui");
  assert(r2.toLowerCase().includes("what should i remind you about"), "set a reminder -> Ask missing content/time");
  assert(listSchedules().length === 0, "No database insertion for 'set a reminder'");

  const r3 = await processMessage("remind me", "tui");
  assert(r3.toLowerCase().includes("what should i remind you about"), "remind me -> Ask missing content/time");
  assert(listSchedules().length === 0, "No database insertion for 'remind me'");

  // 2. Missing Content but Valid Time
  console.log("\n--- 2. Missing Content but Valid Time ---");
  const r4 = await processMessage("set a reminder for 10:52 pm", "tui");
  assert(r4.toLowerCase().includes("what should i remind you about"), "set a reminder for 10:52 pm -> Ask content for time");
  assert(listSchedules().length === 0, "No database insertion for 'set a reminder for 10:52 pm'");

  const r5 = await processMessage("btw you have to set a reminder for 10:52 pm", "tui");
  assert(r5.toLowerCase().includes("what should i remind you about"), "btw you have to set a reminder for 10:52 pm -> Ask content for time");
  assert(listSchedules().length === 0, "No database insertion for command prefix + time");

  // 3. Valid Creation
  console.log("\n--- 3. Valid Creation ---");
  const r6 = await processMessage("remind me to test Creater AI at 10:52 pm", "tui");
  assert(r6.toLowerCase().includes("test creater ai"), "remind me to test Creater AI at 10:52 pm -> Confirmation returned");
  assert(listSchedules().length === 1, "1 reminder created in database");
  assert(String(listSchedules()[0]!.metadata?.reminderTitle).toLowerCase() === "test creater ai", "Title stored as 'test creater ai'");

  const cmdInverted = parseReminderCommand("remind me tomorrow at 8 am to study");
  assert(cmdInverted?.kind === "reminder" && cmdInverted.title?.toLowerCase() === "study" && cmdInverted.timeInput === "tomorrow at 8 am", "Inverted phrase parsing -> title='study', time='tomorrow at 8 am'");

  const cmdPrefixTime = parseReminderCommand("at 10:52 pm remind me to check Creater AI");
  assert(cmdPrefixTime?.kind === "reminder" && cmdPrefixTime.title?.toLowerCase() === "check creater ai" && cmdPrefixTime.timeInput === "10:52 pm", "Prefix time phrase parsing -> title='check Creater AI', time='10:52 pm'");

  // 4. Reminder Retrieval
  console.log("\n--- 4. Reminder Retrieval ---");
  const r7 = await processMessage("btw what was the reminder for", "tui");
  assert(r7.toLowerCase().includes("test creater ai"), "btw what was the reminder for -> returns 'test creater ai'");

  // 5. Multiple Reminders & Recency
  console.log("\n--- 5. Multiple Reminders & Recency ---");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const r8 = await processMessage("set another reminder to study at 11:30 pm", "tui");
  assert(r8.toLowerCase().includes("study"), "Second reminder created for 'study'");
  assert(listSchedules().length === 2, "2 reminders now in database");

  const r9 = await processMessage("what was the last reminder?", "tui");
  assert(r9.toLowerCase().includes("study"), "what was the last reminder? -> resolves most recent reminder 'study'");

  const r10 = await processMessage("show all my reminders", "tui");
  assert(r10.toLowerCase().includes("test creater ai") && r10.toLowerCase().includes("study"), "show all my reminders -> returns both reminders");

  // 6. Multi-turn Clarification & Override Tests
  console.log("\n--- 6. Multi-Turn Clarification & Override Tests ---");
  listSchedules().forEach((job) => deleteSchedule(job.id));

  // Turn 1: set reminder for 11:56 pm now
  const mt1_1 = await processMessage("set reminder for 11:56 pm now", "tui");
  assert(mt1_1.toLowerCase().includes("what should i remind you about"), "Multi-turn Turn 1 -> Asks content");
  assert(listSchedules().length === 0, "Multi-turn Turn 1 -> 0 DB records");

  // Turn 2: to play youtube
  const mt1_2 = await processMessage("to play youtube", "tui");
  assert(mt1_2.toLowerCase().includes("play youtube") && !mt1_2.toLowerCase().includes("opened video"), "Multi-turn Turn 2 -> Creates reminder for 'play youtube' without executing YouTube tool");
  assert(listSchedules().length === 1, "Multi-turn Turn 2 -> 1 DB record created");

  // Turn 3: what is the reminder for
  const mt1_3 = await processMessage("what is the reminder for", "tui");
  assert(mt1_3.toLowerCase().includes("play youtube"), "Multi-turn Turn 3 -> Queries and returns 'play youtube'");

  // Test Cancellation
  listSchedules().forEach((job) => deleteSchedule(job.id));
  await processMessage("set reminder for 8 pm", "tui");
  const cancelRes = await processMessage("never mind", "tui");
  assert(cancelRes.toLowerCase().includes("cancelled"), "Multi-turn Cancellation -> 'never mind' cancels pending state");
  assert(listSchedules().length === 0, "Multi-turn Cancellation -> 0 DB records");

  // Test Explicit Command Override
  listSchedules().forEach((job) => deleteSchedule(job.id));
  await processMessage("set reminder for 8 pm", "tui");
  const overrideRes = await processMessage("open YouTube", "tui");
  assert(overrideRes.toLowerCase().includes("opening youtube"), "Multi-turn Override -> 'open YouTube' overrides pending state and launches YouTube");
  assert(listSchedules().length === 0, "Multi-turn Override -> 0 DB records created");

  console.log("\n================================================");
  console.log("🎉 ALL REMINDER SYSTEM TESTS PASSED SUCCESSFULLY!");
  console.log("================================================\n");
}

main().catch((err) => {
  console.error("Fatal error in Reminder tests:", err);
  process.exit(1);
});
