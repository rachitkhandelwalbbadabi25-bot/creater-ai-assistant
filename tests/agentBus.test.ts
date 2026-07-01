// tests/agentBus.test.ts
import { expect, test, describe } from "bun:test";
import { runAgentBus } from "../src/orchestration/agentBus.ts";

describe("Agent Bus Tests", () => {
  test("runAgentBus processes complex workflow end-to-end", async () => {
    const response = await runAgentBus({
      userGoal: "Please design a database and write code for personal assistant CRM",
      requestId: "test-bus-req",
    });
    expect(response).toContain("Planner");
    expect(response).toContain("Memory");
    expect(response).toContain("Reasoning");
    expect(response).toContain("Execution");
    expect(response).toContain("Verifier");
  });
});
