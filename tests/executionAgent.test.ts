// tests/executionAgent.test.ts
import { expect, test, describe } from "bun:test";
import { executionAgent } from "../src/agents/executionAgent.ts";

describe("Execution Agent Tests", () => {
  test("executionAgent executes planned steps", async () => {
    const context = {
      requestId: "test-req",
      executionMode: "multi-agent",
      plannerAgentOutput: {
        steps: ["Step 1: Init git repository", "Step 2: Install dependencies"],
      },
    };
    const result = await executionAgent(context as any);
    expect(result.result.success).toBe(true);
    expect(result.result.stepsExecuted).toHaveLength(2);
    expect(result.result.outputs).toHaveLength(2);
  });
});
