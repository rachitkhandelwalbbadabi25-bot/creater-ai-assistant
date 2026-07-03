// src/intelligence/dashboard.ts
/**
 * Simple Dashboard Integration
 * Exposes current intelligence metrics, recent suggestions, and skill recommendations.
 * In a real application this would be served via an API endpoint or UI component.
 */
import { getMetrics } from "./intelligenceMetrics";
import { generateSuggestions } from "./proactiveEngine";
import { recommendSkills } from "./skillRecommender";
import { getIntelligenceTelemetry } from "./intelligenceMetrics";

export interface DashboardData {
  metrics: ReturnType<typeof getMetrics>;
  proactiveSuggestions: string[];
  skillRecommendations: string[];
}

/** Retrieve a snapshot of dashboard‑relevant data */
export function getDashboardData(): DashboardData {
  return {
    metrics: getMetrics(),
    proactiveSuggestions: generateSuggestions(),
    skillRecommendations: recommendSkills(),
  };
}

/** Full dashboard report including telemetry */
export function getDashboardReport() {
  return {
    telemetry: {
      intelligence: getIntelligenceTelemetry(),
    },
    data: getDashboardData(),
  };
}

/** Render a minimal textual view for UI/display */
export function renderDashboardView(): string {
  return "Creater AI Intelligence Dashboard – Metrics and Suggestions";
}
