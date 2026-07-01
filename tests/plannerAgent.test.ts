// tests/plannerAgent.test.ts
import { expect, test, describe } from "bun:test";
import { plannerAgent } from "../src/agents/plannerAgent.ts";

describe("Planner Agent Tests", () => {
  test("plannerAgent determines low complexity for short input", async () => {
    const result = await plannerAgent({
      requestId: "test-req",
      executionMode: "multi-agent",
      userGoal: "hi",
    });
    expect(result.result.complexity).toBe("low");
    expect(result.result.requiredAgents).toContain("memoryAgent");
    expect(result.result.requiredAgents).not.toContain("reasoningAgent");
  });

  test("plannerAgent determines high complexity for plan keywords", async () => {
    const result = await plannerAgent({
      requestId: "test-req-2",
      executionMode: "multi-agent",
      userGoal: "Please design a database architecture for my product",
    });
    expect(result.result.complexity).toBe("high");
    expect(result.result.requiredAgents).toContain("reasoningAgent");
    expect(result.result.requiredAgents).toContain("verifierAgent");
  });
});
