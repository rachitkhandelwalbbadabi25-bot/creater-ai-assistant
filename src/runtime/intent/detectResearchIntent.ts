// src/runtime/intent/detectResearchIntent.ts
import { IntentEnum } from "../semantic/semanticTypes.js";
import { detectIntent as detectSemanticIntent } from "../semantic/intentDetector.js";
import type { SemanticResult } from "../semantic/semanticTypes.js";
/**
 * Deterministic detection for research related intents.
 * Returns RESEARCH_TASK or BROWSER_RESEARCH_TASK if detected, otherwise null.
 */
export function detectResearchIntent(message: string): IntentEnum | null {
  // Use existing semantic intent detector which already recognises these intents.
  try {
    const result: SemanticResult = detectSemanticIntent(message);
    if (result.intent === IntentEnum.RESEARCH_TASK) {
      return IntentEnum.RESEARCH_TASK;
    }
    if (result.intent === IntentEnum.BROWSER_RESEARCH_TASK) {
      return IntentEnum.BROWSER_RESEARCH_TASK;
    }
  } catch (e) {
    // ignore errors, fallback to null
  }
  return null;
}
