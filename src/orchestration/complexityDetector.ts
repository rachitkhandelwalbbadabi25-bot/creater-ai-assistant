/* src/orchestration/complexityDetector.ts */

import { logPerf } from "@utils/perf.js";
import { createLogger } from "@utils/logger.js";

export type ComplexityLevel = "low" | "medium" | "high";
export type Mode = "legacy" | "multi-agent";

export interface ComplexityResult {
  complexity: ComplexityLevel;
  score: number; // 0‑100 score
  mode: Mode;
}

const log = createLogger("[COMPLEXITY_DETECTOR]");

// Legacy protection matchers
const legacyPhrases = [
  "hello",
  "hi",
  "hey",
  "how are you",
  "thanks",
  "thank you",
  "good morning",
  "good night",
  "what are you doing",
  "help"
];

// Keyword sets
const planningKeywords = ["plan", "design", "architecture", "create", "build", "develop"];
const researchKeywords = ["research", "study", "analyze", "investigate", "explore"];
const projectKeywords = ["project", "prototype", "product", "feature", "module"];

/**
 * Deterministic complexity detection engine.
 * Protects casual conversations and greetings to remain in legacy mode.
 */
export function detectComplexity(input: string): ComplexityResult {
  const start = Date.now();
  const cleanedInput = input.trim().toLowerCase().replace(/[!.?]+$/g, "");

  // Legacy Path Protection: Greetings, casual conversation, emotional support
  const isLegacyPhrase = legacyPhrases.some((phrase) => cleanedInput === phrase || cleanedInput.startsWith(phrase + " "));
  const words = input.trim().split(/\s+/);
  const wordCount = words.length;

  if (isLegacyPhrase || wordCount < 4) {
    logPerf(log, "Complexity detection completed (forced legacy)", start, { wordCount, complexity: "low", mode: "legacy" });
    return {
      complexity: "low",
      score: 10,
      mode: "legacy",
    };
  }

  // Count occurrences of keyword groups
  const countKeywords = (list: string[]) =>
    words.filter((w) => list.includes(w.toLowerCase())).length;

  const planningScore = countKeywords(planningKeywords);
  const researchScore = countKeywords(researchKeywords);
  const projectScore = countKeywords(projectKeywords);

  // Simple weighted score (0‑100)
  let score = 0;
  score += Math.min(wordCount, 50) * 1; // each word up to 50 contributes 1 point
  score += planningScore * 15;
  score += researchScore * 10;
  score += projectScore * 12;

  // Determine level
  let complexity: ComplexityLevel = "low";
  if (score > 40) complexity = "high";
  else if (score > 20) complexity = "medium";

  const mode: Mode = complexity === "low" ? "legacy" : "multi-agent";

  logPerf(log, "Complexity detection completed", start, { wordCount, score, complexity, mode });
  return { complexity, score, mode };
}
