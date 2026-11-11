import { processMessage } from "../graph/supervisor.js";
import { parseReminderTime, createReminder, listReminders, cancelReminder } from "../scheduler/reminderTools.js";
import { routeFastCommand } from "../graph/commandRouter.js";
import { classifyRuntimeMode } from "../runtime/RuntimeModeClassifier.js";

async function runTests() {
  console.log("=== 1. Testing Reminder Time Parsing ===");
  console.log("Parse 'today 9:05 pm':", parseReminderTime("today 9:05 pm") ? new Date(parseReminderTime("today 9:05 pm")!).toISOString() : "FAILED");
  console.log("Parse 'tomorrow 8 am':", parseReminderTime("tomorrow 8 am") ? new Date(parseReminderTime("tomorrow 8 am")!).toISOString() : "FAILED");
  console.log("Parse 'in 15 minutes':", parseReminderTime("in 15 minutes") ? new Date(parseReminderTime("in 15 minutes")!).toISOString() : "FAILED");

  console.log("\n=== 2. Testing Reminder Execution ===");
  const createRes = await createReminder({ title: "Check India vs West Indies match score", timeInput: "today 9:05 pm" });
  console.log("Create reminder result:", createRes);

  const listRes = listReminders();
  console.log("List reminders result:", listRes);

  if (createRes.reminder?.id) {
    const cancelRes = cancelReminder(createRes.reminder.id);
    console.log("Cancel reminder result:", cancelRes);
  }

  console.log("\n=== 3. Testing Direct URL Routing ===");
  const testUrl = "https://youtu.be/mmYHb4RNdJE?si=abcdef123";
  const fastUrl = routeFastCommand(testUrl);
  console.log("URL fastCommand:", fastUrl);

  console.log("\n=== 4. Testing YouTube Command Routing ===");
  const testYt = "play CarryMinati videos on YouTube";
  const fastYt = routeFastCommand(testYt);
  console.log("YouTube fastCommand:", fastYt);

  console.log("\n=== 5. Testing Identity Queries ===");
  const creatorReply = await processMessage("who created you?");
  console.log("who created you? ->", creatorReply);
  const whoAmIReply = await processMessage("who am i?");
  console.log("who am i? ->", whoAmIReply);
  const nameReply = await processMessage("what is your name?");
  console.log("what is your name? ->", nameReply);

  console.log("\n=== 6. Testing Current Information Query Routing ===");
  const currentCapClass = classifyRuntimeMode("Who is the current captain of the Indian T20 men's cricket team?");
  console.log("Current info query classification:", currentCapClass);
}

runTests().catch(console.error);
