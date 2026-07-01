// tests/verifierAgent.test.ts
import { expect, test, describe } from "bun:test";
import { verifierAgent } from "../src/agents/verifierAgent.ts";

describe("Verifier Agent Tests", () => {
  test("verifierAgent scores execution success", async () => {
    const context = {
      requestId: "test-req",
      executionMode: "multi-agent",
      executionAgentOutput: { success: true },
    };
    const result = await verifierAgent(context as any);
    expect(result.result.success).toBe(true);
    expect(result.result.confidence).toBeGreaterThan(0.9);
  });

  test("verifierAgent catches execution failure", async () => {
    const context = {
      requestId: "test-req",
      executionMode: "multi-agent",
      executionAgentOutput: { success: false },
    };
    const result = await verifierAgent(context as any);
    expect(result.result.success).toBe(false);
    expect(result.result.confidence).toBeLessThan(0.5);
  });
});
