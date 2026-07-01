// tests/reasoningAgent.test.ts
import { expect, test, describe } from "bun:test";
import { reasoningAgent } from "../src/agents/reasoningAgent.ts";

describe("Reasoning Agent Tests", () => {
  test("reasoningAgent executes reasoning flow with context", async () => {
    const result = await reasoningAgent({
      requestId: "test-req",
      executionMode: "multi-agent",
      plannerAgentOutput: { goal: "Write a compiler" },
      memoryAgentOutput: { insights: ["loves functional programming"] },
    } as any);

    expect(result.result.reasoning).toContain("Write a compiler");
    expect(result.result.alternatives).toBeArray();
    expect(result.result.recommendation).toBeString();
  });
});
