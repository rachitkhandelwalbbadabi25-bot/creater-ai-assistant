// src/intelligence/learningEngine.ts
/**
 * Learning Engine – consumes experiences and triggers self‑optimisation.
 * For now it provides a thin wrapper that records the experience and runs
 * the optimisation cycle. In the future this could host ML models.
 */

import { recordExperience, Experience } from "./experienceMemory";
import { runOptimizationCycle } from "./selfOptimizer";
import { incMetric } from "./intelligenceMetrics";
import { generateOptimizations, Optimization } from "./selfOptimizer";
import { generateSuggestions } from "./proactiveEngine";

/** Record an experience and optionally trigger a learning cycle */
export function processExperience(params: {
  success: boolean;
  toolName: string;
  details: Record<string, any>;
  userPreferences?: Record<string, any>;
}): Experience {
  const exp = recordExperience(params);
  // Update a generic metric – number of stored experiences.
  incMetric("experienceCount");
  return exp;
}

/** Run a full learning cycle – currently just runs the optimizer */
export async function runLearningCycle(): Promise<void> {
  await runOptimizationCycle();
}

/** Analyze recent experiences and produce suggestions for the user */
export function learnFromInteraction(): Array<{ type: string; title: string }> {
  const suggestions: Array<{ type: string; title: string }> = [];

  // Optimization suggestions based on failures (now uses >=3 threshold)
  const optimizations: Optimization[] = generateOptimizations();
  for (const opt of optimizations) {
    suggestions.push({ type: "optimization", title: opt.description });
  }

  // Routine suggestions based on frequent tool usage (any tool with >=5 occurrences)
  const recent = generateSuggestions();
  for (const routineTitle of recent) {
    suggestions.push({ type: "routine", title: routineTitle });
  }

  return suggestions;
}

/** Produce an optimisation plan object for tests */
export function generateOptimisationPlan() {
  return { suggestions: generateOptimizations() };
}

export type { Experience };
