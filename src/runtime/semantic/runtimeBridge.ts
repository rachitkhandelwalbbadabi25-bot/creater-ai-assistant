// src/runtime/semantic/runtimeBridge.ts
import type { SemanticPayload } from "./semanticPayload.js";

/** Validation result for SemanticPayload */
export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/** Validate a SemanticPayload and return a structured result. */
export function validateSemanticPayload(payload: SemanticPayload): ValidationResult {
  if (!payload) return { valid: false, reason: "payload missing" };
  if (typeof payload.originalInput !== "string") return { valid: false, reason: "originalInput must be string" };
  if (typeof payload.intent !== "string") return { valid: false, reason: "intent must be string" };
  if (typeof payload.confidence !== "number" || payload.confidence < 0 || payload.confidence > 1) return { valid: false, reason: "confidence out of range" };
  if (!["deterministic", "validation", "conversation"].includes(payload.executionMode)) return { valid: false, reason: "invalid executionMode" };
  return { valid: true };
}

// Types moved to semanticTypes module
import { IntentEnum, ExecutionModeEnum, SemanticResult, SemanticIntent } from "./semanticTypes.js";
import { selectBestRoute, RouteSelection } from "./routeSelector.js";
import { RuntimeRouteEnum } from "./routeTypes.js";
import { createLogger } from "@utils/logger.js";
import { RouteTrace } from "./routeTrace.js";
import { RuntimeCommand } from "../runtimeCommand.js";

/**
 * Maps a validated SemanticPayload to a runtime execution specification.
 * The spec is deliberately lightweight – just a command string and optional args.
 */
export interface RuntimeExecutionSpec {
  command: RuntimeCommand;
  args?: Record<string, unknown>;
}

/**
 * Build a RuntimeExecutionSpec based on a selected route.
 * No mutation of the original payload occurs.
 */
function buildSpecFromSelection(payload: SemanticPayload, selection: RouteSelection): RuntimeExecutionSpec {
  switch (selection.route) {
    case RuntimeRouteEnum.WEB_SEARCH:
      return { command: RuntimeCommand.WEB_SEARCH, args: { query: payload.query } };
    case RuntimeRouteEnum.WEB_NAVIGATION:
      return { command: RuntimeCommand.WEB_NAVIGATION, args: { url: payload.target } };
    case RuntimeRouteEnum.APPLICATION_LAUNCH:
      return { command: RuntimeCommand.APPLICATION_LAUNCH, args: { appName: payload.target } };
    case RuntimeRouteEnum.SYSTEM_COMMAND:
      return { command: RuntimeCommand.SYSTEM_COMMAND, args: { raw: payload.originalInput } };
    case RuntimeRouteEnum.CONVERSATION:
    default:
      return { command: RuntimeCommand.CHAT, args: { input: payload.originalInput } };
  }
}

/**
 * Public API: map a SemanticPayload to a RuntimeExecutionSpec.
 * Internally it validates the payload, selects the best route, optionally
 * creates a trace for observability, and then builds the spec.
 */
export function mapIntentToSpec(payload: SemanticPayload): RuntimeExecutionSpec {
  // Validation – already lightweight, but keep separation.
  const validation = validateSemanticPayload(payload);
  if (!validation.valid) {
    // In production we would throw or handle the error; for now fallback.
    throw new Error(validation.reason ?? "Invalid SemanticPayload");
  }

  // Route selection – deterministic, side‑effect free.
  const selection = selectBestRoute(payload);

  // Optional trace for debugging / observability (no persistence).
  const trace: RouteTrace = {
    requestId: payload.metadata?.normalizedInput ?? `req-${Date.now()}`,
    selectedRoute: selection.route,
    confidence: selection.confidence,
    alternatives: selection.alternatives,
    executionMode: payload.executionMode,
    timestamp: Date.now(),
  };
  // Simple console log – replace with proper logger if needed.
  const log = createLogger("runtime/semantic/runtimeBridge");
  log.debug("Route trace", { ...trace });

  // Build the final spec without mutating the payload.
  return buildSpecFromSelection(payload, selection);
}
