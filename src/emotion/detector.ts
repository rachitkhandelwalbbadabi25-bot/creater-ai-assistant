// ════════════════════════════════════════════════════════════════════════════════
// src/emotion/detector.ts — Hybrid emotion detector (keywords + ML + LLM fallback)
// ════════════════════════════════════════════════════════════════════════════════

import { matchKeywords, type Mood, type EnergyLevel } from "./keywords.js";
import { classifyEmotion } from "./xenova.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("emotion/detector");

// ─── Result Type ──────────────────────────────────────────────────────────────────
export interface EmotionDetection {
  mood: Mood;
  energy: EnergyLevel;
  confidence: number;
  source: "keyword" | "ml" | "combined";
}

/**
 * Detect emotion from text using a hybrid approach:
 *
 * 1. **Keywords first** — instant, zero-cost, handles Hinglish well.
 * 2. **ML model** — transformer classifier for nuanced English text.
 * 3. **Combined** — if both agree, boost confidence; if they disagree, prefer ML.
 *
 * This avoids calling the LLM for emotion (saves tokens and latency).
 */
export async function detectEmotion(text: string): Promise<EmotionDetection> {
  // ── Step 1: Keyword matching (instant) ──────────────────────────────────────
  const keywordResult = matchKeywords(text);

  // ── Step 2: ML classification (fast, ~50ms) ────────────────────────────────
  const mlResult = await classifyEmotion(text);

  // ── Step 3: Combine results ─────────────────────────────────────────────────

  // Case 1: Both available — combine
  if (keywordResult && mlResult) {
    if (keywordResult.mood === mlResult.mood) {
      // Both agree — high confidence
      return {
        mood: keywordResult.mood,
        energy: keywordResult.energy,
        confidence: Math.min((keywordResult.weight + mlResult.confidence) / 2 + 0.15, 1.0),
        source: "combined",
      };
    }

    // Disagree — prefer ML if its confidence is higher, else keyword
    if (mlResult.confidence > keywordResult.weight) {
      return {
        mood: mlResult.mood,
        energy: mlResult.energy,
        confidence: mlResult.confidence * 0.9, // slight penalty for disagreement
        source: "ml",
      };
    }

    return {
      mood: keywordResult.mood,
      energy: keywordResult.energy,
      confidence: keywordResult.weight * 0.9,
      source: "keyword",
    };
  }

  // Case 2: Only keyword match
  if (keywordResult) {
    return {
      mood: keywordResult.mood,
      energy: keywordResult.energy,
      confidence: keywordResult.weight,
      source: "keyword",
    };
  }

  // Case 3: Only ML result
  if (mlResult) {
    return {
      mood: mlResult.mood,
      energy: mlResult.energy,
      confidence: mlResult.confidence,
      source: "ml",
    };
  }

  // Case 4: Neither — default to neutral
  return {
    mood: "neutral",
    energy: "medium",
    confidence: 0.3,
    source: "keyword",
  };
}

/**
 * Quick emotion check using only keywords (no ML, no latency).
 * Used when speed is critical (e.g., routing decisions).
 */
export function detectEmotionFast(text: string): EmotionDetection {
  const kw = matchKeywords(text);
  if (kw) {
    return { mood: kw.mood, energy: kw.energy, confidence: kw.weight, source: "keyword" };
  }
  return { mood: "neutral", energy: "medium", confidence: 0.3, source: "keyword" };
}
