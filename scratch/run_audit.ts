import { processMessageStreaming } from "../src/graph/supervisor.ts";

async function main() {
  const input = "Open Google, search AI agents, and give me a summary.";
  try {
    const result = await processMessageStreaming(input, "web", (token) => process.stdout.write(token));
    console.log("\nFinal result:", result);
  } catch (e) {
    console.error("Error during processing:", e);
  }
}

main();
