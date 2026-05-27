/* src/conversation/runtime/QualityGuard.ts */

import { ReasoningBudget, RuntimeValidationResult } from "../types";

/** Simple heuristics to improve response quality */
export class QualityGuard {
  /**
   * Apply all quality checks to the raw response text.
   * Returns a possibly trimmed / cleaned version.
   */
  static apply(raw: string, budget?: ReasoningBudget): string {
    let text = raw;
    // 1. Enforce max length if budget provided
    if (budget && budget.maxResponseLength) {
      text = QualityGuard.enforceMaxLength(text, budget.maxResponseLength);
    }
    // 2. Remove obvious repetitive phrases
    text = QualityGuard.removeRepetitivePhrases(text);
    // 3. Remove longer repeated patterns (e.g., "I think I think")
    text = QualityGuard.removeRepeatedPhrases(text);
    // 4. Trim awkward filler words (simple list)
    text = QualityGuard.removeAwkwardFillers(text);
    // 5. Simple Hindi‑English mix guard – strip common Hindi words if present in English context
    text = QualityGuard.sanitizeHindiEnglishMix(text);
    return text.trim();
  }

  /** Trim text to a maximum character count, appending ellipsis when truncated */
  private static enforceMaxLength(text: string, max: number): string {
    if (text.length <= max) return text;
    return text.slice(0, max).trimEnd() + "...";
  }

  /** Remove repeated consecutive words (e.g., "very very good") */
  private static removeRepetitivePhrases(text: string): string {
    // Replace duplicated consecutive words (case‑insensitive)
    return text.replace(/\b(\w+)(?:\s+\1\b)+/gi, "$1");
  }

  /** Remove longer repeated patterns (e.g., "I think I think") */
  private static removeRepeatedPhrases(text: string): string {
    // Detect a two‑word phrase that repeats back‑to‑back
    return text.replace(/\b(\w+\s+\w+)(?:\s+\1)+/gi, "$1");
  }

  /** Strip common filler/awkward tokens */
  private static removeAwkwardFillers(text: string): string {
    const fillers = ["um", "uh", "like", "you know", "actually", "basically"];
    const pattern = new RegExp(`\\b(?:${fillers.join("|")})\\b`, "gi");
    return text.replace(pattern, "");
  }

  /** Simple safeguard to avoid Hindi‑English mixing in English‑only responses */
  private static sanitizeHindiEnglishMix(text: string): string {
    // Detect presence of Devanagari characters and remove them
    return text.replace(/[\u0900-\u097F]+/g, "");
  }
}
