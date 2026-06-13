// src/runtime/semantic/confidenceEngine.ts
import { SemanticResult } from "./semanticTypes.js";

/**
 * Returns a normalized confidence level category used by the router.
 * - "high"   => deterministic execution (>= 0.85)
 * - "mid"    => validation/fallback (0.60 - 0.84)
 * - "low"    => conversation fallback (< 0.60)
 */
export function getConfidenceCategory(result: SemanticResult): "high" | "mid" | "low" {
  const { confidence } = result;
  if (confidence >= 0.85) return "high";
  if (confidence >= 0.60) return "mid";
  return "low";
}
