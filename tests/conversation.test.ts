import { describe, expect, test } from "bun:test";
import {
  Supervisor,
  ConversationEngine,
  InputUnderstandingLayer,
  IntentDetector,
  ConversationStateEngine,
  ResponseStrategySelector,
  PersonalityRenderer,
} from "../src/conversation/index";

describe("Conversational Runtime Architecture Verification", () => {
  test("InputUnderstandingLayer normalizes raw user text", () => {
    const layer = new InputUnderstandingLayer();
    expect(layer.process("  hello   world  ")).toBe("hello world");
  });

  test("IntentDetector detects simple greeting", () => {
    const detector = new IntentDetector();
    const intent = detector.detect("hello");
    expect(intent.name).toBe("greeting");
    expect(intent.confidence).toBeGreaterThan(0.9);
  });

  test("ResponseStrategySelector selects greeting payload", () => {
    const selector = new ResponseStrategySelector();
    const strategy = selector.select({ name: "greeting", confidence: 0.99, entities: {} });
    expect(strategy.type).toBe("direct");
    expect(strategy.payload).toContain("Hello! I am Creater AI");
  });

  test("PersonalityRenderer renders tone tag properly", () => {
    const renderer = new PersonalityRenderer();
    const result = renderer.render("Hello", { name: "Creater", tone: "friendly" });
    expect(result).toBe("[friendly] Hello");
  });

  test("ConversationStateEngine handles state lifecycle", () => {
    const engine = new ConversationStateEngine();
    const userId = "test-user-123";
    const message = { id: userId, text: "hello", timestamp: Date.now() };

    const state = engine.initState(userId, message);
    expect(state.userId).toBe(userId);
    expect(state.lastMessage.text).toBe("hello");

    const updated = engine.updateIntent(state, { name: "greeting", confidence: 0.99, entities: {} });
    expect(updated.interactionMode).toBe("casual");
    expect(updated.recentIntents).toHaveLength(1);
  });

  test("ConversationEngine processes complete turn", async () => {
    const engine = new ConversationEngine();
    const result = await engine.processTurn({
      id: "user-abc",
      text: "hello",
      timestamp: Date.now(),
    });
    expect(result.text).toBe("Hello! I am Creater AI. How can I assist you today?");
  });

  test("Supervisor handles user turns cleanly", async () => {
    const supervisor = new Supervisor();
    const result = await supervisor.handleMessage({
      id: "user-xyz",
      text: "hello",
      timestamp: Date.now(),
    });
    expect(result.text).toBe("Hello! I am Creater AI. How can I assist you today?");
  });
});
