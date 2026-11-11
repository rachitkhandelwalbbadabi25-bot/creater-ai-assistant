import { describe, it, expect } from "bun:test";
import { routeFastCommand } from "../src/graph/commandRouter";
import { containsFactualAttribute } from "../src/runtime/semantic/intentDetector";
import { classifyRuntimeMode } from "../src/runtime/RuntimeModeClassifier";

describe("Memory Query & Routing Fixes", () => {
  it("does not trigger false-positive age factual attribute on 'language'", () => {
    expect(containsFactualAttribute("what is my favorite programming language?")).toBe(false);
    expect(containsFactualAttribute("what is virat kohli age")).toBe(true);
  });

  it("routes memory queries directly to memory_query fast command", () => {
    const cmd1 = routeFastCommand("what is my favorite programming language?");
    expect(cmd1).not.toBeNull();
    expect(cmd1?.kind).toBe("memory_query");

    const cmd2 = routeFastCommand("tell me what is my favorite programming language");
    expect(cmd2).not.toBeNull();
    expect(cmd2?.kind).toBe("memory_query");

    const cmd3 = routeFastCommand("meri favorite programming language kya hai");
    expect(cmd3).not.toBeNull();
    expect(cmd3?.kind).toBe("memory_query");
  });

  it("classifies memory query as execution mode targeting laptopAgent without web search", () => {
    const classification = classifyRuntimeMode("what is my favorite programming language?");
    expect(classification.mode).toBe("execution");
    expect(classification.targetAgent).toBe("laptopAgent");
    expect(classification.reason).toBe("fast-command:memory_query");
  });
});

