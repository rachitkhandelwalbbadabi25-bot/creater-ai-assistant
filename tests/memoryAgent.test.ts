// tests/memoryAgent.test.ts
import { expect, test, describe } from "bun:test";
import { memoryAgent } from "../src/agents/memoryAgent.ts";

describe("Memory Agent Tests", () => {
  test("memoryAgent returns structured context", async () => {
    const result = await memoryAgent({
      requestId: "test-req",
      executionMode: "multi-agent",
    });
    expect(result.result.memories).toBeArray();
    expect(result.result.insights).toBeArray();
    expect(result.result.personality).toBeObject();
  });
});
