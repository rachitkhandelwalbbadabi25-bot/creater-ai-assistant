// src/intelligence/proactiveEngine.ts
/**
 * Proactive Engine – monitors experiences and routines to generate
 * suggestions and predict next actions. This is a lightweight heuristic
 * implementation suitable for the current phase.
 */

import { getExperiences, Experience } from "./experienceMemory";
import { listRoutines, Routine } from "./routineEngine";
import { incMetric } from "./intelligenceMetrics";

/** Generate high‑level suggestions based on recent experiences and routines */
export function generateSuggestions(): string[] {
  const suggestions: string[] = [];
  const recent = getExperiences().slice(-20);
  // Simple rule: if many failures from a tool, suggest creating a routine.
  const failCount: Record<string, number> = {};
  for (const exp of recent) {
    if (!exp.success) {
      failCount[exp.toolName] = (failCount[exp.toolName] ?? 0) + 1;
    }
  }
  for (const [tool, cnt] of Object.entries(failCount)) {
    if (cnt >= 3) {
      suggestions.push(`Consider creating a routine to handle frequent failures of tool "${tool}".`);
    }
  }
  // Suggest running optimizer if experience count is high.
  if (recent.length > 50) {
    suggestions.push("Run the self‑optimizer to clean up low‑risk issues.");
  }
  incMetric("proactiveSuggestions", suggestions.length);
  return suggestions;
}

/** Predict the next likely action based on pattern of tool usage */
export function predictNextAction(): string | null {
  const exps = getExperiences();
  if (exps.length < 5) return null;
  const last = exps[exps.length - 1];
  return `User may want to run tool "${last.toolName}" again.`;
}

/** Detect opportunities such as unused routines or stale experiences */
export function detectOpportunities(): { type: string; detail: string }[] {
  const ops: { type: string; detail: string }[] = [];
  // Unused routines (no executions)
  const routines = listRoutines();
  for (const r of routines) {
    if (r.executionCount === 0) {
      ops.push({ type: "routine", detail: `Routine "${r.name}" has never been executed.` });
    }
  }
  // Stale experiences older than 7 days
  const now = Date.now();
  const stale = getExperiences().filter(e => now - e.timestamp > 7 * 24 * 60 * 60 * 1000);
  if (stale.length > 0) {
    ops.push({ type: "experience", detail: `${stale.length} experiences are older than 7 days.` });
  }
  return ops;
}

/** Evaluate detected opportunities – return array with priority */
export function evaluateProactiveOpportunities(): { type: string; detail: string; priority: string }[] {
  const ops = detectOpportunities();
  return ops.map(op => ({
    ...op,
    priority: op.type === "routine" ? "high" : "low",
  }));
}

export type { Experience, Routine };
