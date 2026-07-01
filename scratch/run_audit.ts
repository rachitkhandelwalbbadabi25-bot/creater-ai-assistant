// scratch/run_audit.ts
import { processMessage } from "../src/graph/supervisor.js";

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("=== STARTING AUDIT RUNNER ===");
  
  // Test A: Single Request
  console.log("\n--- TEST A: Single Request ---");
  const resp1 = await processMessage("how are you bro", "tui");
  console.log("Response 1:", resp1);

  await delay(2000);

  // Test B: Multi Request (sequential)
  console.log("\n--- TEST B: Multi Request 1 ---");
  const resp2 = await processMessage("how are you bro", "tui");
  console.log("Response 2:", resp2);

  await delay(2000);

  console.log("\n--- TEST B: Multi Request 2 ---");
  const resp3 = await processMessage("what are you doing now bro", "tui");
  console.log("Response 3:", resp3);

  await delay(2000);

  console.log("\n--- TEST B: Multi Request 3 ---");
  const resp4 = await processMessage("Create a detailed business plan for Creater AI", "tui");
  console.log("Response 4:", resp4);

  console.log("\n=== AUDIT RUNNER COMPLETED ===");
}

main().catch((err) => {
  console.error("Audit runner failed:", err);
});
