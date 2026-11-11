// ════════════════════════════════════════════════════════════════════════════════
// tests/conversationRouting.test.ts — Conversation Agent & Routing Regression Suite
// ════════════════════════════════════════════════════════════════════════════════

import { describe, test, expect } from "bun:test";
import { routeRequest } from "../src/llm/router.js";
import { classifyRuntimeMode } from "../src/runtime/RuntimeModeClassifier.js";
import { processMessageStreaming } from "../src/graph/supervisor.js";

describe("Conversation Routing & Agent Architecture", () => {
  test("1. Casual Hinglish conversation routes to conversationAgent", async () => {
    const input = "aur kya kar raha ha tu abb";
    const mode = classifyRuntimeMode(input);
    expect(mode.mode).toBe("conversational");

    const decision = await routeRequest(input);
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.value.agent).toBe("conversationAgent");
      expect(decision.value.intent.intent).toBe("conversation");
    }
  });

  test("2. English casual conversation routes to conversationAgent", async () => {
    const input = "what are your thoughts on quantum computing?";
    const mode = classifyRuntimeMode(input);
    expect(mode.mode).toBe("conversational");

    const decision = await routeRequest(input);
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.value.agent).toBe("conversationAgent");
    }
  });

  test("3. Explicit task execution continues to route to execution / laptopAgent", async () => {
    const input = "open notepad and type hello";
    const mode = classifyRuntimeMode(input);
    expect(mode.mode).toBe("execution");
    expect(mode.targetAgent).toBe("laptopAgent");
  });

  test("4. Reminder creation continues to route to execution", async () => {
    const input = "remind me to check email in 15 minutes";
    const mode = classifyRuntimeMode(input);
    expect(mode.mode).toBe("execution");
  });

  test("5. Streaming pipeline delivers clean user-facing error when Ollama is unreachable without crashing", async () => {
    let streamedTokens = "";
    const result = await processMessageStreaming("kya haal chaal bhai", "web", (token) => {
      streamedTokens += token;
    });

    expect(result).toBeDefined();
    expect(streamedTokens.length).toBeGreaterThan(0);
    expect(result).toContain("AI se connect nahi ho pa raha");
  });
});

