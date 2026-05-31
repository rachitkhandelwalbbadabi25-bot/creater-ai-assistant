// src/runtime/deterministicOrchestration/parser.ts
import { ExecutionPlan } from "./types.ts";

/**
 * Parse a raw user input into a deterministic execution plan.
 * Splits on conjunctions like "and" or "then" (case‑insensitive).
 * Returns an ExecutionPlan with each step as a trimmed command string.
 */
export function parseExecutionPlan(input: string): ExecutionPlan {
  // Normalise whitespace and split on conjunctions
  const rawSteps = input
    .trim()
    .split(/\s+(?:and|then)\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const steps = rawSteps.map((cmd) => ({ command: cmd }));

  return { steps };
}
