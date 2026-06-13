// src/runtime/semantic/semanticNormalizer.ts
/**
 * Simple normalizer – trims whitespace and collapses multiple spaces.
 * It does **not** lower‑case the string because some downstream logic
 * (e.g., entity extraction) may rely on original casing.
 */
export function normalize(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}
