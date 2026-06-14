import { describe, expect, test } from "bun:test";
import { classifyRuntimeMode } from "../src/runtime/RuntimeModeClassifier.js";
import { IntentEnum } from "../src/runtime/semantic/semanticTypes.js";
import { mapIntentToSpec } from "../src/runtime/semantic/runtimeBridge.js";
import { RuntimeRouteEnum } from "../src/runtime/semantic/routeTypes.js";
import { RuntimeCommand } from "../src/runtime/runtimeCommand.js";

describe("Conversation Intent Canonicalization & Routing", () => {
  test("hello bro maps to IntentEnum.CONVERSATION", () => {
    const classification = classifyRuntimeMode("hello bro");
    expect(classification.intent).toBe(IntentEnum.CONVERSATION);
  });

  test("how are you maps to IntentEnum.CONVERSATION", () => {
    const classification = classifyRuntimeMode("how are you");
    expect(classification.intent).toBe(IntentEnum.CONVERSATION);
  });

  test("mapIntentToSpec maps IntentEnum.CONVERSATION to CONVERSATION route and CHAT command", () => {
    const spec = mapIntentToSpec({
      originalInput: "how are you",
      intent: IntentEnum.CONVERSATION,
      confidence: 0.95,
      executionMode: "conversation",
      source: "semantic"
    });
    expect(spec.route).toBe(RuntimeRouteEnum.CONVERSATION);
    expect(spec.command).toBe(RuntimeCommand.CHAT);
    expect(spec.args?.input).toBe("how are you");
  });
});
