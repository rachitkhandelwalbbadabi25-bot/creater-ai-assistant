// ════════════════════════════════════════════════════════════════════════════════
// scratch/verify_llm_graph.ts — Verify LLM actually uses Knowledge Graph context
// ════════════════════════════════════════════════════════════════════════════════

import { storeFact } from "../src/memory/longTerm.js";
import { processMessage } from "../src/graph/supervisor.js";

async function runVerification() {
  console.log("🧪 Starting LLM Knowledge Graph Verification...\n");

  // 1. Inject a unique favorite color into the graph
  const uniqueColor = "Neon Purple (Ultraviolet)";
  console.log(`📝 Setting favorite color to: ${uniqueColor}`);
  storeFact("preference", "favorite_color", uniqueColor);

  // 2. Ask the LLM about it
  console.log("\n💬 Asking AI: 'Mera favorite color kya hai?'");
  const response = await processMessage("Mera favorite color kya hai?", "tui");

  console.log("\n🤖 AI Response:");
  console.log("--------------------------------------------------");
  console.log(response);
  console.log("--------------------------------------------------");

  // 3. Verify
  if (response.includes(uniqueColor) || response.includes("Neon Purple")) {
    console.log("\n✅ VERIFIED: LLM correctly used the Knowledge Graph context!");
  } else {
    console.log("\n❌ FAILED: LLM did not reflect the graph context in its response.");
  }

  console.log("\n✨ Verification complete.");
}

runVerification().catch(console.error);
