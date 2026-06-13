// src/runtime/semantic/semanticClarifier.ts
import { RuntimeRouteEnum } from "./routeTypes.js";
import type { RouteSelection } from "./routeSelector.js";

export interface ClarificationResponse {
  message: string;
  suggestions: string[];
}

/**
 * Build a deterministic clarification response based on the route selection.
 * No LLM calls, orchestration, planner or reasoning models are used.
 */
export function buildClarification(selection: RouteSelection): ClarificationResponse {
  const suggestions = selection.alternatives.map((alt) => {
    switch (alt.route) {
      case RuntimeRouteEnum.WEB_NAVIGATION:
        return "Open website";
      case RuntimeRouteEnum.WEB_SEARCH:
        return "Search information";
      case RuntimeRouteEnum.APPLICATION_LAUNCH:
        return "Launch application";
      case RuntimeRouteEnum.SYSTEM_COMMAND:
        return "Run system command";
      case RuntimeRouteEnum.CONVERSATION:
        return "Continue conversation";
      default:
        return "Proceed";
    }
  });

  // Debug log guarded by IS_RUNTIME_DEBUG
  if (process.env.IS_RUNTIME_DEBUG === "true") {
    console.debug("SEMANTIC VALIDATION PATH ACTIVE", { selection, suggestions });
  }

  return {
    message: "Did you mean:",
    suggestions,
  };
}
