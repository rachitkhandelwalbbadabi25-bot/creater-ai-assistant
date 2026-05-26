// packages/convo/src/intent/IntentDetector.ts

import { Intent } from "../types";

/**
 * Very small deterministic intent detector for Phase 1.
 * It uses simple keyword matching – no external LLM.
 */
export class IntentDetector {
  detect(text: string): Intent {
    const lowered = text.toLowerCase();
    if (/\b(hi|hello|hey)\b/.test(lowered)) {
      return { name: "greeting", confidence: 0.99, entities: {} };
    }
    if (/\bsearch\b/.test(lowered) || /\bfind\b/.test(lowered)) {
      return { name: "search", confidence: 0.95, entities: {} };
    }
    if (/\bweather\b/.test(lowered)) {
      return { name: "weather", confidence: 0.9, entities: {} };
    }
    return { name: "fallback", confidence: 0.5, entities: {} };
  }
}
