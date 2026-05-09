// ════════════════════════════════════════════════════════════════════════════════
// scratch/test_rag_pipeline.ts — Testing vector memory and semantic retrieval
// ════════════════════════════════════════════════════════════════════════════════

import { initVectorStore, addEntry, search } from "../src/memory/vector.js";
import { retrieveContext } from "../src/memory/retriever.js";
import { storeFact } from "../src/memory/longTerm.js";

async function runTest() {
  console.log("🧪 Starting RAG Pipeline Testing...\n");

  // 1. Initialize
  initVectorStore();

  // 2. Add some test memories
  console.log("Adding sample memories...");
  await addEntry("Creater loves to help with coding tasks in TypeScript.", { type: "interest" });
  await addEntry("The user's favorite programming language is Python, but they are learning Bun.", { type: "fact" });
  await addEntry("Yesterday we talked about building a smart TUI for the assistant.", { type: "conversation" });

  // 3. Add a long-term fact
  storeFact("preference", "theme", "dark mode");
  console.log("✅ Added sample memories and facts.");

  // 4. Test Semantic Search
  console.log("\nTesting Semantic Search (query: 'What does the assistant like?')");
  const results = await search("What does the assistant like?");
  results.forEach(r => {
    console.log(`- [Score: ${r.score.toFixed(2)}] ${r.entry.text}`);
  });

  // 5. Test Full Retrieval Context
  console.log("\nTesting Full Context Retrieval (query: 'Tell me about the TUI and my preferences')");
  const context = await retrieveContext({
    query: "Tell me about the TUI and my preferences",
    semanticResultCount: 3
  });

  console.log("\n--- Retrieved Context ---");
  console.log("Relevant Memories (RAG):");
  context.relevantMemories.forEach((m: string) => console.log(`  ${m}`));
  
  console.log("\nUser Profile Facts:");
  context.userProfileFacts?.forEach((f: any) => console.log(`  • ${f.key}: ${f.value}`));

  console.log("\n🏁 RAG Test Completed.");
}

runTest().catch(console.error);
