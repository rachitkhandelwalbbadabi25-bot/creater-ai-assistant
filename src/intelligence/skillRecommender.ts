// src/intelligence/skillRecommender.ts
/**
 * Skill Recommender – suggests useful tools/skills based on recent experiences.
 * For demonstration, it analyses the most frequent tool names in the last N experiences
 * and recommends those tools as potential skills to explore.
 */

import { getExperiences, Experience } from "./experienceMemory";
import { incMetric } from "./intelligenceMetrics";

/** Number of recent experiences to analyse */
const ANALYSIS_WINDOW = 50;

/** Simple recommendation based on tool usage frequency */
export function recommendSkills(): string[] {
  const recent: Experience[] = getExperiences().slice(-ANALYSIS_WINDOW);
  const toolFrequency: Record<string, number> = {};
  recent.forEach((exp) => {
    toolFrequency[exp.toolName] = (toolFrequency[exp.toolName] ?? 0) + 1;
  });

  // Sort tools by descending frequency and take top 3 as recommendations
  const sorted = Object.entries(toolFrequency)
    .sort((a, b) => b[1] - a[1])
    .map((entry) => entry[0]);

  const recommendations = sorted.slice(0, 3);
  // Record metric for number of recommendations generated
  incMetric("suggestionCount", recommendations.length);
  return recommendations;
}

export type { Experience };
