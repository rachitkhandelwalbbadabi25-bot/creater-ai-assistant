// src/intelligence/selfOptimizer.ts
/**
 * Self Optimizer Engine
 * Analyzes system performance and past experiences to generate and apply low‑risk optimizations.
 */

import { getExperiences } from "./experienceMemory";
import { incMetric, setMetric } from "./intelligenceMetrics";

export type Optimization = {
  id: string;
  description: string;
  risk: "low" | "medium" | "high";
  /** Optional async function that performs the optimization */
  apply?: () => Promise<void>;
};

/** Simple performance snapshot – placeholder for real metrics */
export async function analyzePerformance(): Promise<Record<string, number>> {
  // For now we just count experiences as a proxy for load.
  const experienceCount = getExperiences().length;
  // In a real system you could gather CPU, memory, latency, etc.
  return { experienceCount };
}

/** Generate a list of optimizations based on recent experiences */
export function generateOptimisationPlan() {
  const suggestions = generateOptimizations();
  return { suggestions };
}

export function generateOptimizations(): Optimization[] {
  const experiences = getExperiences().slice(-100); // recent 100
  const suggestions: Optimization[] = [];

  // Track successes and failures per tool
  const successMap: Record<string, number> = {};
  const failureMap: Record<string, number> = {};
  for (const exp of experiences) {
    if (exp.success) {
      successMap[exp.toolName] = (successMap[exp.toolName] ?? 0) + 1;
    } else {
      failureMap[exp.toolName] = (failureMap[exp.toolName] ?? 0) + 1;
    }
  }
  // Low‑risk: enable cache after many successes (>=5)
  for (const [tool, count] of Object.entries(successMap)) {
    if (count >= 5) {
      suggestions.push({
        id: `enable-cache-${tool}`,
        description: `Enable cache for tool "${tool}" (observed ${count} recent successes).`,
        risk: "low",
        apply: async () => {
          console.log(`Enabling cache for ${tool}`);
        },
      });
    }
  }
  // Low‑risk: clean cache after many failures (>=3)
  for (const [tool, count] of Object.entries(failureMap)) {
    if (count >= 3) {
      suggestions.push({
        id: `cleanup-${tool}`,
        description: `Clean up cache for tool "${tool}" (observed ${count} recent failures).`,
        risk: "low",
        apply: async () => {
          console.log(`Auto‑cleaning cache for ${tool}`);
        },
      });
    }
  }
  // Medium‑risk example: suggest increasing retention limit.
  if (experiences.length > 8000) {
    suggestions.push({
      id: "increase-retention",
      description: "Consider increasing experience store retention limit.",
      risk: "medium",
    });
  }
  return suggestions;
}

// Tracking applied and pending optimizations for test reporting
const appliedOptimizations: string[] = [];
const pendingOptimizations: string[] = [];

/** Apply a single optimization, respecting its risk level */
export async function applyOptimization(opt: Optimization): Promise<void> {
  if (opt.risk === "low" && opt.apply) {
    await opt.apply();
    incMetric("autoAppliedCount");
    appliedOptimizations.push(opt.id);
  } else {
    // For medium/high risk we record the suggestion for user approval.
    incMetric("suggestionCount");
    pendingOptimizations.push(opt.id);
  }
}

/** Approve a pending suggestion and mark it as applied */
export function approveSuggestion(pendingId: string): void {
  const index = pendingOptimizations.indexOf(pendingId);
  if (index !== -1) {
    pendingOptimizations.splice(index, 1);
    appliedOptimizations.push(pendingId);
    incMetric("autoAppliedCount");
  }
}

/** Run a full optimization cycle: analyze, generate, and apply where safe */
export async function runOptimizationCycle(): Promise<{ applied: string[]; pendingUserApproval: string[] }> {
  const perf = await analyzePerformance();
  // Record a generic performance metric.
  setMetric("experienceCount", perf.experienceCount);

  const opts = generateOptimizations();
  // Reset previous cycle results
  appliedOptimizations.length = 0;
  pendingOptimizations.length = 0;
  for (const opt of opts) {
    await applyOptimization(opt);
  }
  return { applied: [...appliedOptimizations], pendingUserApproval: [...pendingOptimizations] };
}
