import { parseMemoryStoreInput, isMemoryListInput } from "../memory/memoryParser.js";
import { storeFact, getFact, getAllFacts, buildUserProfile } from "../memory/longTerm.js";
import { processMessage } from "../graph/supervisor.js";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${msg}`);
    process.exit(1);
  } else {
    console.log(`✅ PASSED: ${msg}`);
  }
}

async function main() {
  console.log("=== RUNNING PHASE 3 — REAL LONG-TERM MEMORY TESTS ===");

  // 1. Parsing Tests
  const p1 = parseMemoryStoreInput("remember that my name is Rachit");
  assert(p1 !== null && p1.key === "user_name" && p1.value === "Rachit", "parseMemoryStoreInput('remember that my name is Rachit') -> user_name: Rachit");

  const p2 = parseMemoryStoreInput("remember I created Creater AI");
  assert(p2 !== null && p2.value === "Creater AI", "parseMemoryStoreInput('remember I created Creater AI') -> Creater AI");

  const p3 = parseMemoryStoreInput("remember that I prefer dark mode");
  assert(p3 !== null && p3.category === "preference", "parseMemoryStoreInput('remember that I prefer dark mode') -> preference");

  assert(isMemoryListInput("what do you remember about me?"), "isMemoryListInput('what do you remember about me?') -> true");

  // 2. Direct SQLite DB Store & Read Tests
  const stored = storeFact("person", "test_user_name", "Rachit Test", 1.0, "unit_test");
  assert(stored !== null, "storeFact() returned Fact object");

  const retrieved = getFact("person", "test_user_name");
  assert(retrieved !== undefined && retrieved.value === "Rachit Test", "getFact() returned persisted fact from SQLite DB");

  const allFacts = getAllFacts();
  assert(allFacts.length > 0, "getAllFacts() returned non-empty facts list");

  // 3. E2E Pipeline Memory Write & Read Verification
  console.log("\n--- E2E Pipeline Memory Test ---");
  const storeRes = await processMessage("remember that my name is Rachit", "tui");
  console.log(`STORE RESPONSE: ${storeRes}`);
  assert(storeRes.includes("saved that to my long-term memory"), "Pipeline memory store response confirmed persistence");

  const listRes = await processMessage("what do you remember about me?", "tui");
  console.log(`LIST RESPONSE:\n${listRes}`);
  assert(listRes.includes("Rachit"), "Pipeline memory retrieval response contains saved fact 'Rachit'");

  console.log("\n🎉 ALL PHASE 3 REAL LONG-TERM MEMORY TESTS PASSED!");
}

main().catch((err) => {
  console.error("Fatal error in Phase 3 tests:", err);
  process.exit(1);
});
