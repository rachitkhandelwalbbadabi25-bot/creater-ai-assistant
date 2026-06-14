import type { SemanticPayload } from "./semanticPayload.js";
import { IntentEnum } from "./semanticTypes.js";
import { selectBestRoute, type RouteSelection } from "./routeSelector.js";
import { RuntimeRouteEnum } from "./routeTypes.js";
import { createLogger } from "@utils/logger.js";
import { RuntimeCommand } from "../runtimeCommand.js";
import { IS_RUNTIME_DEBUG } from "@utils/perf.js";

const log = createLogger("runtime/semantic/runtimeBridge");

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export interface RuntimeExecutionSpec {
  command: RuntimeCommand;
  args?: Record<string, unknown>;
  route: RuntimeRouteEnum;
}

export interface ExecutionTrace {
  input: string;
  extractedQuery?: string;
  intent: string;
  confidence: number;
  route: RuntimeRouteEnum;
  command: RuntimeCommand;
  tool: string;
  success: boolean;
  response: string;
}

export function validateSemanticPayload(payload: SemanticPayload): ValidationResult {
  if (!payload) return { valid: false, reason: "payload missing" };
  if (typeof payload.originalInput !== "string" || payload.originalInput.trim().length === 0) {
    return { valid: false, reason: "originalInput must be non-empty string" };
  }
  if (typeof payload.intent !== "string") return { valid: false, reason: "intent must be string" };
  if (typeof payload.confidence !== "number" || payload.confidence < 0 || payload.confidence > 1) {
    return { valid: false, reason: "confidence out of range" };
  }
  return { valid: true };
}

export function validateRouteCommandAlignment(
  intent: IntentEnum,
  route: RuntimeRouteEnum,
): { route: RuntimeRouteEnum; command: RuntimeCommand } {
  switch (intent) {
    case IntentEnum.BROWSER_SEARCH:
    case IntentEnum.INFORMATION_SEARCH:
      if (route !== RuntimeRouteEnum.WEB_SEARCH) {
        log.warn("Route and intent mismatch corrected", { intent, from: route, to: RuntimeRouteEnum.WEB_SEARCH });
      }
      return { route: RuntimeRouteEnum.WEB_SEARCH, command: RuntimeCommand.WEB_SEARCH };
    case IntentEnum.CONVERSATION:
      if (route !== RuntimeRouteEnum.CONVERSATION) {
        log.warn("Route and intent mismatch corrected", { intent, from: route, to: RuntimeRouteEnum.CONVERSATION });
      }
      return { route: RuntimeRouteEnum.CONVERSATION, command: RuntimeCommand.CHAT };
    case IntentEnum.APP_LAUNCH:
      if (route !== RuntimeRouteEnum.APPLICATION_LAUNCH) {
        log.warn("Route and intent mismatch corrected", { intent, from: route, to: RuntimeRouteEnum.APPLICATION_LAUNCH });
      }
      return { route: RuntimeRouteEnum.APPLICATION_LAUNCH, command: RuntimeCommand.APPLICATION_LAUNCH };
    case IntentEnum.SYSTEM_ACTION:
      if (route !== RuntimeRouteEnum.SYSTEM_COMMAND) {
        log.warn("Route and intent mismatch corrected", { intent, from: route, to: RuntimeRouteEnum.SYSTEM_COMMAND });
      }
      return { route: RuntimeRouteEnum.SYSTEM_COMMAND, command: RuntimeCommand.SYSTEM_COMMAND };
    default:
      return { route, command: RuntimeCommand.CHAT };
  }
}

export function validateCommand(command: RuntimeCommand, args?: Record<string, unknown>): ValidationResult {
  switch (command) {
    case RuntimeCommand.WEB_SEARCH:
      return typeof args?.query === "string" && args.query.trim().length > 0
        ? { valid: true }
        : { valid: false, reason: "WEB_SEARCH requires query" };
    case RuntimeCommand.CHAT:
      return typeof args?.input === "string" && args.input.trim().length > 0
        ? { valid: true }
        : { valid: false, reason: "CHAT requires input" };
    case RuntimeCommand.APPLICATION_LAUNCH:
      return typeof args?.appName === "string" && args.appName.trim().length > 0
        ? { valid: true }
        : { valid: false, reason: "APPLICATION_LAUNCH requires target" };
    case RuntimeCommand.SYSTEM_COMMAND:
      return typeof args?.raw === "string" && args.raw.trim().length > 0
        ? { valid: true }
        : { valid: false, reason: "SYSTEM_COMMAND requires action" };
    case RuntimeCommand.WEB_NAVIGATION:
      return typeof args?.url === "string" && args.url.trim().length > 0
        ? { valid: true }
        : { valid: false, reason: "WEB_NAVIGATION requires url" };
    default:
      return { valid: false, reason: "Unknown runtime command" };
  }
}

function buildSpecFromSelection(payload: SemanticPayload, selection: RouteSelection): RuntimeExecutionSpec {
  const aligned = validateRouteCommandAlignment(payload.intent, selection.route);
  switch (aligned.command) {
    case RuntimeCommand.WEB_SEARCH:
      return { command: aligned.command, route: aligned.route, args: { query: payload.query } };
    case RuntimeCommand.WEB_NAVIGATION:
      return { command: aligned.command, route: aligned.route, args: { url: payload.target } };
    case RuntimeCommand.APPLICATION_LAUNCH:
      return { command: aligned.command, route: aligned.route, args: { appName: payload.target } };
    case RuntimeCommand.SYSTEM_COMMAND:
      return { command: aligned.command, route: aligned.route, args: { raw: payload.originalInput } };
    default:
      return { command: RuntimeCommand.CHAT, route: RuntimeRouteEnum.CONVERSATION, args: { input: payload.originalInput } };
  }
}

export function mapIntentToSpec(payload: SemanticPayload): RuntimeExecutionSpec {
  const validation = validateSemanticPayload(payload);
  if (!validation.valid) {
    throw new Error(validation.reason ?? "Invalid SemanticPayload");
  }

  const selection = selectBestRoute(payload);
  const spec = buildSpecFromSelection(payload, selection);
  const commandValidation = validateCommand(spec.command, spec.args);
  if (!commandValidation.valid) {
    throw new Error(commandValidation.reason ?? "Invalid runtime command");
  }

  if (IS_RUNTIME_DEBUG) {
    log.info("ExecutionTrace", {
      input: payload.originalInput,
      extractedQuery: payload.query,
      intent: payload.intent,
      confidence: payload.confidence,
      route: spec.route,
      command: spec.command,
      tool: spec.command,
      success: true,
      response: "spec-generated",
    } satisfies ExecutionTrace);
  }

  return spec;
}
