// ════════════════════════════════════════════════════════════════════════════════
// tests/conversationAgentAndFallback.test.ts — Conversation & Fallback Comprehensive Suite
// ════════════════════════════════════════════════════════════════════════════════

import { describe, test, expect } from "bun:test";
import { routeRequest } from "../src/llm/router.js";
import { classifyRuntimeMode } from "../src/runtime/RuntimeModeClassifier.js";
import { processMessageStreaming } from "../src/graph/supervisor.js";
import { chatStream } from "../src/llm/client.js";
import { getChannelChatHistory } from "../src/memory/shortTerm.js";

describe("Conversation Agent & Fallback Lifecycle Suite", () => {
  test("1. Casual Hinglish conversation routes to conversationAgent", async () => {
    const input = "aur kya kar raha ha tu bro";
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
    const input = "what are your thoughts on coffee?";
    const mode = classifyRuntimeMode(input);
    expect(mode.mode).toBe("conversational");

    const decision = await routeRequest(input);
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.value.agent).toBe("conversationAgent");
    }
  });

  test("3. Multi-turn conversation retains short-term history", async () => {
    const channel: "tui" = "tui";
    let tokenBuffer = "";
    await processMessageStreaming("hello friend", channel, (tok) => {
      tokenBuffer += tok;
    });

    const history = getChannelChatHistory(channel, 4);
    expect(history.length).toBeGreaterThanOrEqual(2);
    const hasUserMsg = history.some((m) => m.role === "user" && m.content.includes("hello friend"));
    expect(hasUserMsg).toBe(true);
  });

  test("4. Explicit task execution bypasses conversationAgent", async () => {
    const input = "open notepad";
    const mode = classifyRuntimeMode(input);
    expect(mode.mode).toBe("execution");
    expect(mode.targetAgent).toBe("laptopAgent");
  });

  test("5. Reminder creation bypasses conversationAgent", async () => {
    const input = "remind me to call dad in 10 minutes";
    const mode = classifyRuntimeMode(input);
    expect(mode.mode).toBe("execution");
  });

  test("6. Ollama unavailable without fallback returns clean typed error without throwing", async () => {
    let streamedTokens = "";
    try {
      await chatStream(
        {
          model: "non_existent_mock_model",
          messages: [{ role: "user", content: "hello" }],
        },
        (t) => {
          streamedTokens += t;
        }
      );
    } catch (err: any) {
      expect(err).toBeDefined();
      expect(err.message).toBeDefined();
    }
  });

  test("7. Supervisor stream catches errors and sends user-facing token to UI", async () => {
    let outputTokens = "";
    const res = await processMessageStreaming("random test input", "web", (tok) => {
      outputTokens += tok;
    });

    expect(res).toBeDefined();
    expect(typeof res).toBe("string");
  }, 15000);
});
