// src/runtime/semantic/routeScorer.ts
import { SemanticPayload } from "./semanticPayload.js";
import { IntentEnum } from "./semanticTypes.js";
import { RuntimeRouteEnum } from "./routeTypes.js";

/** Candidate route with its associated score */
export interface RouteCandidate {
  route: RuntimeRouteEnum;
  score: number;
}

/** Mapping from IntentEnum to the most appropriate RuntimeRouteEnum */
function intentToRoute(intent: IntentEnum): RuntimeRouteEnum {
  switch (intent) {
    case IntentEnum.BROWSER_SEARCH:
      return RuntimeRouteEnum.WEB_SEARCH;
    case IntentEnum.APP_LAUNCH:
      return RuntimeRouteEnum.APPLICATION_LAUNCH;
    case IntentEnum.SYSTEM_ACTION:
      return RuntimeRouteEnum.SYSTEM_COMMAND;
    case IntentEnum.INFORMATION_SEARCH:
      return RuntimeRouteEnum.WEB_SEARCH;
    case IntentEnum.CONVERSATION:
      return RuntimeRouteEnum.CONVERSATION;
    default:
      return RuntimeRouteEnum.CONVERSATION;
  }
}

/**
 * Score a single candidate route based on payload data.
 * The scoring logic is deliberately simple and deterministic:
 *   - Base contribution from overall confidence (0‑1).
 *   - Bonus if the route matches the intent‑to‑route mapping.
 *   - Additional contribution from intentConfidence map if present.
 */
function scoreCandidate(payload: SemanticPayload, route: RuntimeRouteEnum): number {
  const baseConfidence = typeof payload.confidence === "number" ? payload.confidence : 0;
  const intentMatch = intentToRoute(payload.intent) === route ? 0.3 : 0; // bonus for direct intent match
  const intentSpecificConfidence =
    payload.intentConfidence && typeof payload.intentConfidence === "object"
      ? payload.intentConfidence[payload.intent] ?? 0
      : 0;
  // Weighted sum – weights add to 1 (0.5, 0.3, 0.2)
  const score = 0.5 * baseConfidence + 0.3 * intentMatch + 0.2 * intentSpecificConfidence;
  return Number(score.toFixed(4));
}

/** Generate scores for all supported routes */
export function scoreRoutes(payload: SemanticPayload): RouteCandidate[] {
  const candidates: RouteCandidate[] = [];
  const allRoutes = Object.values(RuntimeRouteEnum);
  for (const route of allRoutes) {
    const score = scoreCandidate(payload, route as RuntimeRouteEnum);
    candidates.push({ route: route as RuntimeRouteEnum, score });
  }
  // Return sorted descending by score for convenience
  return candidates.sort((a, b) => b.score - a.score);
}
