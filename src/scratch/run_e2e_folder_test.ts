import { processMessage } from "../graph/supervisor.js";

async function main() {
  console.log("=== RUNNING REAL E2E FOLDER ROUTING TEST ===");
  
  const testInputs = [
    "open screenshot folder",
    "find screenshot folder",
    "show me screenshot folder",
    "search screenshot folder",
    "find information about AI",
  ];

  for (const input of testInputs) {
    console.log(`\n----------------------------------------`);
    console.log(`TESTING INPUT: "${input}"`);
    console.log(`----------------------------------------`);
    try {
      const response = await processMessage(input, "tui");
      console.log(`RESPONSE FOR "${input}":\n-> ${response}`);
    } catch (err) {
      console.error(`ERROR FOR "${input}":`, err);
    }
  }

  console.log("\n=== REAL E2E FOLDER ROUTING TEST COMPLETE ===");
}

main();
