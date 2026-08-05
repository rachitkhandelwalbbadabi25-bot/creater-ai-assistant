import { processMessage } from "../graph/supervisor.js";

async function main() {
  try {
    console.log("=== RUNNING COMMAND 1: Open Google, search AI agents, and give me a summary. ===");
    const result1 = await processMessage("Open Google, search AI agents, and give me a summary.", "tui");
    console.log("=== FINAL RESULT 1 ===", result1);

    console.log("=== RUNNING COMMAND 2: Research LangGraph and explain it. ===");
    const result2 = await processMessage("Research LangGraph and explain it.", "tui");
    console.log("=== FINAL RESULT 2 ===", result2);
  } catch (e) {
    console.error("Error during execution", e);
  }
}

main();

