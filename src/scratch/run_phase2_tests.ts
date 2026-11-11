import {
  isActionIntent,
  hasVerifiedSuccessfulExecution,
  enforceActionExecutionGuard,
} from "../validation/actionExecutionGuard.js";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${msg}`);
    process.exit(1);
  } else {
    console.log(`✅ PASSED: ${msg}`);
  }
}

console.log("=== RUNNING PHASE 2 — GLOBAL ACTION EXECUTION GUARD TESTS ===");

// 1. Intent Classification
assert(isActionIntent("system_control"), "isActionIntent('system_control') -> true");
assert(isActionIntent("file_operation"), "isActionIntent('file_operation') -> true");
assert(isActionIntent("app_launch"), "isActionIntent('app_launch') -> true");
assert(!isActionIntent("conversation"), "isActionIntent('conversation') -> false");
assert(!isActionIntent("chitchat"), "isActionIntent('chitchat') -> false");

// 2. Execution Verification
assert(!hasVerifiedSuccessfulExecution([]), "hasVerifiedSuccessfulExecution([]) -> false");
assert(
  !hasVerifiedSuccessfulExecution([{ tool: "system.open_app", result: { success: false, error: "Not found" } }]),
  "hasVerifiedSuccessfulExecution([failed tool]) -> false"
);
assert(
  hasVerifiedSuccessfulExecution([{ tool: "system.open_app", result: { success: true, message: "Task completed" } }]),
  "hasVerifiedSuccessfulExecution([successful tool]) -> true"
);
assert(
  hasVerifiedSuccessfulExecution([{ tool: "launcher.open", result: "Opening Notepad..." }]),
  "hasVerifiedSuccessfulExecution([string feedback]) -> true"
);

// 3. Action Execution Guard Enforcement
const g1 = enforceActionExecutionGuard("system_control", [], "I opened the app.");
assert(
  !g1.allowed && g1.guardedResponse.includes("couldn't execute that action"),
  "Action intent with empty tools -> rejected with truthful message"
);

const g2 = enforceActionExecutionGuard("system_control", [{ tool: "test", result: { success: false } }], "Done!");
assert(
  !g2.allowed && g2.guardedResponse.includes("couldn't execute that action"),
  "Action intent with failed tool -> rejected with truthful message"
);

const g3 = enforceActionExecutionGuard("system_control", [{ tool: "test", result: { success: true } }], "Opening app...");
assert(
  g3.allowed && g3.guardedResponse === "Opening app...",
  "Action intent with verified tool -> allowed"
);

const g4 = enforceActionExecutionGuard("conversation", [], "Hello!");
assert(
  g4.allowed && g4.guardedResponse === "Hello!",
  "Conversational intent with no tools -> allowed"
);

console.log("\n🎉 ALL PHASE 2 EXECUTION GUARD TESTS PASSED!");
