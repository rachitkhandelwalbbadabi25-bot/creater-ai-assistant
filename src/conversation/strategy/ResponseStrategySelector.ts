// packages/convo/src/strategy/ResponseStrategySelector.ts

import { Intent, ResponseStrategy, PersonalityProfile } from "../types";

/**
 * Very small deterministic selector for Phase 1.
 * It maps an Intent to a static response payload.
 * In later phases this could become a LLM‑driven planner.
 */
export class ResponseStrategySelector {
  /**
   * Select a strategy based on the detected intent.
   * The `personality` can influence the wording – for now we just pass it
   * through, the renderer will apply tone.
   */
  select(intent: Intent, personality?: PersonalityProfile): ResponseStrategy {
    switch (intent.name) {
      case "greeting":
        return { type: "direct", payload: "Hello! I am Creater AI. How can I assist you today?" };
      case "search":
        return { type: "direct", payload: "Sure, what would you like me to search for?" };
      case "weather":
        return { type: "direct", payload: "Please tell me the location you want the weather for." };
      default:
        return { type: "fallback", payload: "I’m not sure how to help with that yet. Could you re‑phrase?" };
    }
  }
}
