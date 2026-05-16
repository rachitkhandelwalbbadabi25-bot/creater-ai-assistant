// ════════════════════════════════════════════════════════════════════════════════
// scratch/verify_retrieval_only.ts — Prove retrieval logic works without LLM
// ════════════════════════════════════════════════════════════════════════════════

import { storeFact } from "../src/memory/longTerm.js";
import { retrieveContext } from "../src/memory/retriever.js";
import { contextToString, buildFullContext } from "../src/utils/contextBuilder.js";

async function test() {
  const fact = "Neon Purple (Ultraviolet)";
  storeFact("preference", "favorite_color", fact);

  const query = "Mera favorite color kya hai?";
  const memCtx = await retrieveContext({ query, includeProfile: true });
  
  const fullCtx = buildFullContext(null, memCtx);
  const contextStr = contextToString(fullCtx);

  console.log("🔍 Testing Retrieval Logic for Query: " + query);
  console.log("--------------------------------------------------");
  console.log(contextStr);
  console.log("--------------------------------------------------");

  if (contextStr.includes(fact)) {
    console.log("\n✅ SUCCESS: The Graph Node '" + fact + "' was successfully extracted and injected into the context!");
  } else {
    console.log("\n❌ FAILURE: Fact not found in context.");
  }
}

test().catch(console.error);
