// src/runtime/semantic/routeTrace.ts
import { RuntimeRouteEnum } from "./routeTypes.js";
import { ExecutionModeEnum } from "./semanticExecutionPolicy.js";
import { RouteCandidate } from "./routeScorer.js";

export interface RouteTrace {
  requestId: string;
  selectedRoute: RuntimeRouteEnum;
  confidence: number;
  alternatives: RouteCandidate[];
  executionMode: ExecutionModeEnum;
  timestamp: number;
}
