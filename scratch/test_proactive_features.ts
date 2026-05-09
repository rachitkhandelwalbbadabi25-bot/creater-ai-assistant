// ════════════════════════════════════════════════════════════════════════════════
// scratch/test_proactive_features.ts — Testing briefing, battery and late night alerts
// ════════════════════════════════════════════════════════════════════════════════

import { generateMorningBriefing, onBriefingReady } from "../src/proactive/briefing.js";
import { checkBatteryAlert, checkLateNightAlert, onAlertReady } from "../src/proactive/alerts.js";
import { initVectorStore } from "../src/memory/vector.js";

async function runTest() {
  console.log("🧪 Starting Proactive Features Testing...\n");

  // Initialize
  initVectorStore();

  // Setup callbacks
  onBriefingReady((msg) => {
    console.log("\n--- [DELIVERED] Morning Briefing ---");
    console.log(msg);
    console.log("------------------------------------\n");
  });

  onAlertReady((msg) => {
    console.log("\n--- [DELIVERED] Proactive Alert ---");
    console.log(msg);
    console.log("-----------------------------------\n");
  });

  // 1. Test Morning Briefing
  console.log("1. Generating Morning Briefing...");
  await generateMorningBriefing();

  // 2. Test Battery Alert (Mocking if needed, but we check real status)
  console.log("2. Checking Battery Status...");
  await checkBatteryAlert();
  console.log("   (Alert will only trigger if battery < 20%)");

  // 3. Test Late Night Alert
  console.log("3. Checking Late Night Alert...");
  checkLateNightAlert();
  console.log("   (Alert will only trigger if time is between 11PM and 4AM)");

  console.log("\n🏁 Proactive Test Completed.");
}

runTest().catch(console.error);
