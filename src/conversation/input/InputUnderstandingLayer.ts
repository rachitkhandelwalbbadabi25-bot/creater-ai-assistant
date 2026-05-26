// packages/convo/src/input/InputUnderstandingLayer.ts

/**
 * InputUnderstandingLayer – Phase 1 placeholder.
 * It normalises raw user text (trims whitespace, collapses spaces, lower‑cases).
 * In later phases it could perform language detection, profanity filtering, etc.
 */
export class InputUnderstandingLayer {
  /**
   * Process raw input and return a normalised string.
   */
  process(raw: string): string {
    // Basic normalisation – deterministic and cheap.
    return raw.trim().replace(/\s+/g, " ");
  }
}
