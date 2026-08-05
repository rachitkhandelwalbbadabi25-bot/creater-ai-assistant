import { processMessage } from "../graph/supervisor.js";

async function runAll() {
  const commands = [
    "Open Google, search AI agents, and give me a summary.",
    "Open GitHub and search LangGraph.",
    "Open YouTube and search AI agents.",
    "Search Stack Overflow for Playwright browser automation.",
    "Open Wikipedia and search Artificial Intelligence.",
    "Open Google Maps and search Agra."
  ];
  for (const cmd of commands) {
    console.log(`=== RUNNING COMMAND: ${cmd} ===`);
    try {
      const result = await processMessage(cmd, "tui");
      console.log(`=== RESULT FOR: ${cmd} ===`, result);
    } catch (e) {
      console.error(`Error executing ${cmd}:`, e);
    }
  }
}

runAll();
