import {
  executeTool,
  resolveToolTimeout,
  exponentialBackoff,
} from "../agents/toolExecutor.js";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${msg}`);
    process.exit(1);
  } else {
    console.log(`✅ PASSED: ${msg}`);
  }
}

async function main() {
  console.log("=== RUNNING PHASE 4 — EXECUTION RELIABILITY & RETRY TESTS ===");

  // 1. Timeout Resolution Tests
  assert(resolveToolTimeout("computer.play_youtube") === 30000, "resolveToolTimeout('computer.play_youtube') -> 30000ms");
  assert(resolveToolTimeout("browser.navigate") === 30000, "resolveToolTimeout('browser.navigate') -> 30000ms");
  assert(resolveToolTimeout("web_search") === 20000, "resolveToolTimeout('web_search') -> 20000ms");
  assert(resolveToolTimeout("system.volume") === 10000, "resolveToolTimeout('system.volume') -> 10000ms");

  // 2. Exponential Backoff Test
  assert(exponentialBackoff(1, 200) === 200, "exponentialBackoff(1) -> 200ms");
  assert(exponentialBackoff(2, 200) === 400, "exponentialBackoff(2) -> 400ms");
  assert(exponentialBackoff(3, 200) === 800, "exponentialBackoff(3) -> 800ms");

  // 3. Retry on Transient Error Test
  let callCount = 0;
  const transientTool = async () => {
    callCount++;
    if (callCount === 1) {
      throw new Error("network timeout error");
    }
    return "retried success";
  };

  const retryRes = await executeTool(transientTool, { maxAttempts: 3, baseDelayMs: 50 });
  assert(retryRes.success === true, "Transient failure retried successfully");
  assert(retryRes.attempts === 2, "Tool succeeded on attempt 2");
  assert(retryRes.result === "retried success", "Correct result returned from attempt 2");

  // 4. Fatal Error Non-Retry Test
  let fatalCallCount = 0;
  const fatalTool = async () => {
    fatalCallCount++;
    throw new Error("invalid input parameters abort");
  };

  const fatalRes = await executeTool(fatalTool, { maxAttempts: 3, baseDelayMs: 50 });
  assert(fatalRes.success === false, "Fatal error tool failed");
  assert(fatalCallCount === 1, "Fatal error stopped retries on attempt 1");

  console.log("\n🎉 ALL PHASE 4 EXECUTION RELIABILITY & RETRY TESTS PASSED!");
}

main().catch((err) => {
  console.error("Fatal error in Phase 4 tests:", err);
  process.exit(1);
});
