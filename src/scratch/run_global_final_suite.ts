import { processMessage } from "../graph/supervisor.js";
import { routeFastCommand } from "../graph/commandRouter.js";
import { classifyRuntimeMode } from "../runtime/RuntimeModeClassifier.js";
import { storeFact, getFact } from "../memory/longTerm.js";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${msg}`);
    process.exit(1);
  } else {
    console.log(`✅ PASSED: ${msg}`);
  }
}

async function main() {
  console.log("===========================================================");
  console.log("=== CREATER AI — GLOBAL FINAL EXECUTION REGRESSION SUITE ===");
  console.log("===========================================================\n");

  // 1. LOCAL ACTIONS
  console.log("--- 1. LOCAL ACTIONS ---");
  const act1 = await processMessage("open screenshot folder", "tui");
  assert(act1.includes("Opening Screenshots folder"), "open screenshot folder -> Opening Screenshots folder");
  await new Promise((r) => setTimeout(r, 500));

  const act2 = await processMessage("find screenshot folder", "tui");
  assert(act2.includes("Opening Screenshots folder"), "find screenshot folder -> Opening Screenshots folder");
  await new Promise((r) => setTimeout(r, 500));

  const act3 = await processMessage("show me screenshot folder", "tui");
  assert(act3.includes("Opening Screenshots folder"), "show me screenshot folder -> Opening Screenshots folder");
  await new Promise((r) => setTimeout(r, 500));

  const act4 = await processMessage("open Documents", "tui");
  assert(act4.includes("Opening Documents folder"), "open Documents -> Opening Documents folder");
  await new Promise((r) => setTimeout(r, 500));

  const act5 = await processMessage("open Desktop", "tui");
  assert(act5.includes("Opening Desktop folder"), "open Desktop -> Opening Desktop folder");
  await new Promise((r) => setTimeout(r, 500));

  const act6 = await processMessage("open Chrome", "tui");
  assert(act6.includes("Opening Google Chrome"), "open Chrome -> Opening Google Chrome");
  await new Promise((r) => setTimeout(r, 500));

  const act7 = await processMessage("open YouTube", "tui");
  assert(act7.includes("Opening YouTube"), "open YouTube -> Opening YouTube");
  await new Promise((r) => setTimeout(r, 500));

  // 2. WEB / SEARCH
  console.log("\n--- 2. WEB / SEARCH ---");
  const web1 = await processMessage("search screenshot folder", "tui");
  assert(web1.includes("Searching Google"), "search screenshot folder -> Searching Google");

  const web2 = await processMessage("find information about AI", "tui");
  assert(web2.length > 20 && !web2.includes("Opening"), "find information about AI -> Informative search response");

  const web3 = await processMessage("look up AI agents", "tui");
  assert(web3.length > 20 && !web3.includes("Opening"), "look up AI agents -> Informative search response");

  // 3. YOUTUBE PLAY & SEARCH
  console.log("\n--- 3. YOUTUBE ---");
  const ytPlay1 = routeFastCommand("play CarryMinati videos on YouTube");
  assert(ytPlay1?.kind === "youtube" && (ytPlay1 as any).action === "play", "play CarryMinati videos on YouTube -> youtube play");

  const ytPlay2 = routeFastCommand("play first video which you see on youtube of hustle 5");
  assert(ytPlay2?.kind === "youtube" && (ytPlay2 as any).selection === "first", "play first video... -> selection first");

  const ytSearch = routeFastCommand("search YouTube for CarryMinati");
  assert(ytSearch?.kind === "youtube" && (ytSearch as any).action === "search", "search YouTube for CarryMinati -> youtube search");

  // 4. REMINDERS
  console.log("\n--- 4. REMINDERS ---");
  const rem1 = await processMessage("set a reminder to check deployment tomorrow at 10am", "tui");
  assert(rem1.toLowerCase().includes("reminder"), "set a reminder -> Reminder created");

  const rem2 = await processMessage("list reminders", "tui");
  assert(rem2.includes("reminders") || rem2.includes("Reminders"), "list reminders -> Reminders listed");

  // 5. MEMORY
  console.log("\n--- 5. MEMORY ---");
  const memStore = await processMessage("remember that my name is Rachit", "tui");
  assert(memStore.includes("saved that to my long-term memory"), "remember that my name is Rachit -> Saved to memory");

  const memRead = await processMessage("what do you remember about me?", "tui");
  assert(memRead.toLowerCase().includes("rachit"), "what do you remember about me? -> Retrieved Rachit");

  // 6. FAILURE SAFETY / ACTION EXECUTION GUARD
  console.log("\n--- 6. FAILURE SAFETY / ACTION GUARD ---");
  const guardOutput = await processMessage("open invalid_unrecognized_fake_xyz_app_9999", "tui");
  assert(
    !guardOutput.toLowerCase().includes("task completed") &&
    !guardOutput.toLowerCase().includes("i opened") &&
    (guardOutput.includes("couldn't execute that action") || guardOutput.includes("couldn't determine a concrete action") || guardOutput.includes("No valid app")),
    "Invalid app action -> Rejected with truthful failure message, NO false success claim!"
  );

  console.log("\n===========================================================");
  console.log("🎉 ALL GLOBAL FINAL EXECUTION REGRESSION TESTS PASSED!");
  console.log("===========================================================\n");
}

main().catch((err) => {
  console.error("Fatal error in Global Final Suite:", err);
  process.exit(1);
});
