// ════════════════════════════════════════════════════════════════════════════════
// tests/cuaPolicy.test.ts — CUA Execution Policy & Fallback Router Tests
// ════════════════════════════════════════════════════════════════════════════════

import { describe, test, expect } from "bun:test";
import { evaluateCuaPolicy } from "../src/cua/cuaPolicy.js";

describe("Phase 5 Step 2 — CUA Execution Policy Tests", () => {
  // Scenario 1: Native tool available → Native selected
  test("1. Native tool available selects NATIVE layer", () => {
    const res = evaluateCuaPolicy({ toolId: "fs.read_file", params: { path: "test.txt" } });
    expect(res.targetLayer).toBe("NATIVE");
    expect(res.decision).toBe("CUA_NOT_REQUIRED");
  });

  // Scenario 2: DOM tool available → DOM selected
  test("2. Structured browser DOM tool selects DOM layer", () => {
    const res = evaluateCuaPolicy({ toolId: "browser.navigate", params: { url: "https://example.com" } });
    expect(res.targetLayer).toBe("DOM");
    expect(res.decision).toBe("CUA_NOT_REQUIRED");
  });

  // Scenario 3: Visual interaction required → CUA selected
  test("3. Visual interaction required selects CUA layer", () => {
    const res = evaluateCuaPolicy({
      toolId: "cua.click_coordinate",
      params: { x: 100, y: 200 },
      requiresVisualInteraction: true,
    });
    expect(res.targetLayer).toBe("CUA");
    expect(res.decision).toBe("CUA_REQUIRED");
  });

  // Scenario 4: Retryable failure does NOT trigger CUA
  test("4. Retryable failure maintains current layer and does NOT trigger CUA", () => {
    const res = evaluateCuaPolicy({
      toolId: "browser.navigate",
      failure: {
        attemptedLayer: "DOM",
        error: "Tool execution timeout",
        isRetryable: true,
        reason: "Transient error",
      },
    });
    expect(res.targetLayer).toBe("DOM");
    expect(res.decision).toBe("CUA_NOT_REQUIRED");
    expect(res.reason).toContain("retry");
  });

  // Scenario 5: Safety rejection produces CUA_UNAVAILABLE
  test("5. Safety policy rejection results in CUA_UNAVAILABLE", () => {
    const res = evaluateCuaPolicy({
      toolId: "shell.execute_dangerous",
      params: { command: "rm -rf /" },
      safetyApproved: false,
    });
    expect(res.decision).toBe("CUA_UNAVAILABLE");
    expect(res.requiresConfirmation).toBe(true);
  });

  // Scenario 6: User cancellation produces CUA_UNAVAILABLE
  test("6. User cancellation results in CUA_UNAVAILABLE", () => {
    const res = evaluateCuaPolicy({
      toolId: "cua.click_coordinate",
      userCancelled: true,
    });
    expect(res.decision).toBe("CUA_UNAVAILABLE");
    expect(res.reason).toContain("cancelled");
  });

  // Scenario 7: Permanent DOM failure permits CUA fallback
  test("7. Permanent non-retryable DOM failure allows CUA fallback", () => {
    const res = evaluateCuaPolicy({
      toolId: "computer.click_selector",
      failure: {
        attemptedLayer: "DOM",
        error: "Selector '#canvas-target' not found",
        isRetryable: false,
        reason: "Missing element",
      },
    });
    expect(res.targetLayer).toBe("CUA");
    expect(res.decision).toBe("CUA_ALLOWED");
  });

  // Scenario 8: Default native tool execution behavior remains unchanged
  test("8. Existing default tool execution paths remain unchanged", () => {
    const chatRes = evaluateCuaPolicy({ toolId: "chat", params: { input: "hello" } });
    expect(chatRes.targetLayer).toBe("NATIVE");
    expect(chatRes.decision).toBe("CUA_NOT_REQUIRED");

    const searchRes = evaluateCuaPolicy({ toolId: "web_search", params: { query: "news" } });
    expect(searchRes.targetLayer).toBe("NATIVE");
    expect(searchRes.decision).toBe("CUA_NOT_REQUIRED");
  });
});
