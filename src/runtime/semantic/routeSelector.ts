// src/runtime/semantic/routeSelector.ts
import { scoreRoutes, RouteCandidate } from "./routeScorer.js";
import { RuntimeRouteEnum } from "./routeTypes.js";
import type { SemanticPayload } from "./semanticPayload.js";

export interface RouteSelection {
  route: RuntimeRouteEnum;
  confidence: number;
  alternatives: RouteCandidate[];
  reason: string;
  ambiguous: boolean;
}

/**
 * Select the best route based on scored candidates.
 * Does not mutate the payload, does not invoke LLM, and does not decide execution mode.
 */
export function selectBestRoute(payload: SemanticPayload): RouteSelection {
  const candidates = scoreRoutes(payload);
  const top = candidates[0];
  const second = candidates[1];
  const topScore = top?.score ?? 0;
  const secondScore = second?.score ?? 0;

  const ambiguous = topScore - secondScore < 0.15;

  const reason = `Selected route ${top?.route} with confidence ${topScore}`;

  return {
    route: top?.route ?? RuntimeRouteEnum.CONVERSATION,
    confidence: topScore,
    alternatives: candidates,
    reason,
    ambiguous,
  };
}
