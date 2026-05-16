// ════════════════════════════════════════════════════════════════════════════════
// scratch/test_graph_system.ts — Rigorous testing for the Knowledge Graph (Improved)
// ════════════════════════════════════════════════════════════════════════════════

import { storeFact } from "../src/memory/longTerm.js";
import { getGraphStats, getNodeWithEdges, searchGraph } from "../src/memory/graph.js";
import { retrieveContext } from "../src/memory/retriever.js";

async function runTest() {
  console.log("🚀 Improved Knowledge Graph Test...\n");

  // Clear or ensure fresh data is handled by storeFact (upsert)
  storeFact("fact", "residence", "Uttar Pradesh");
  storeFact("preference", "coding", "TypeScript aur Bun");

  console.log("🔍 1. Direct Search Test:");
  const res1 = searchGraph("Uttar Pradesh");
  console.log(`   Search 'Uttar Pradesh': ${res1.length} found`);
  if (res1[0]) console.log(`   Label: ${res1[0].label}, Type: ${res1[0].type}`);

  console.log("\n🔍 2. Keyword-based Retrieval Test:");
  // Simulate retriever extracting "TypeScript" as a keyword
  const context = await retrieveContext({ query: "I love TypeScript", includeProfile: true });
  
  console.log("   Relevant Memories in context:");
  const graphMemories = context.relevantMemories.filter(m => m.startsWith("[graph:"));
  graphMemories.forEach(m => console.log(`     • ${m}`));

  if (graphMemories.length > 0) {
    console.log("\n✅ SUCCESS: Graph nodes are being injected into retrieval context.");
  } else {
    console.log("\n❌ FAILURE: Graph nodes not found in context. Check retriever.ts logic.");
  }

  console.log("\n🕸️ 3. Relationship Integrity:");
  const user = getNodeWithEdges("User");
  const hasRelation = user?.edges.some(e => e.target.label === "Uttar Pradesh");
  console.log(`   User -> Uttar Pradesh relation exists: ${hasRelation ? "YES" : "NO"}`);

  console.log("\n✨ Test complete.");
}

runTest().catch(console.error);
