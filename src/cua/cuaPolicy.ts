// ════════════════════════════════════════════════════════════════════════════════
// src/cua/cuaPolicy.ts — CUA Execution Policy & Fallback Router Foundation (Phase 5 Step 2)
// Enforces execution precedence: Native / API → Structured DOM → CUA Visual Fallback
// ════════════════════════════════════════════════════════════════════════════════

import { createLogger } from "@utils/logger.js";
import { validateCommand, checkToolSafety } from "../tools/safety.js";

const log = createLogger("cua/policy");

export type ExecutionLayer = "NATIVE" | "DOM" | "CUA";
export type CuaDecision =
  | "CUA_NOT_REQUIRED"
  | "CUA_ALLOWED"
  | "CUA_REQUIRED"
  | "CUA_UNAVAILABLE";

export interface CuaPolicyRequest {
  toolId: string;
  params?: Record<string, unknown>;
  failure?: {
    attemptedLayer: ExecutionLayer;
    error: string;
    isRetryable: boolean;
    reason?: string;
  };
  requiresVisualInteraction?: boolean;
  userCancelled?: boolean;
  safetyApproved?: boolean;
}

export interface CuaPolicyResult {
  targetLayer: ExecutionLayer;
  decision: CuaDecision;
  reason: string;
  requiresConfirmation: boolean;
}

/** Known native / API tools that do not use browser DOM or GUI */
const NATIVE_TOOLS = new Set([
  "fs.read_file",
  "fs.write_file",
  "fs.delete_file",
  "fs.list_directory",
  "fs.create_directory",
  "fs.move_file",
  "fs.copy_file",
  "fs.search_files",
  "fs.file_metadata",
  "shell.execute",
  "shell.execute_dangerous",
  "system.info",
  "system.process_list",
  "system.process_kill",
  "system.clipboard",
  "system.env",
  "system.notify",
  "system.open_app",
  "system.open_path",
  "editor.open_file",
  "git.status",
  "git.commit",
  "chat",
  "web_search",
]);

/** Known structured DOM browser tools */
const DOM_TOOLS = new Set([
  "browser.navigate",
  "browser.extract_text",
  "browser.screenshot",
  "computer.open_browser",
  "computer.navigate",
  "computer.click",
  "computer.click_selector",
  "computer.type",
  "computer.press_key",
  "computer.shortcut",
  "computer.scroll",
  "computer.get_text",
  "computer.fill_form",
  "computer.play_youtube",
  "computer.close_browser",
]);

/** Known inherently visual / CUA fallback actions */
const CUA_VISUAL_TOOLS = new Set([
  "cua.click_coordinate",
  "cua.drag_and_drop",
  "cua.canvas_interact",
  "cua.visual_locate",
]);

/**
  Evaluate execution precedence and determine whether CUA fallback is appropriate.
  Enforces precedence: Native → DOM → CUA
 */
export function evaluateCuaPolicy(request: CuaPolicyRequest): CuaPolicyResult {
  const { toolId, params, failure, requiresVisualInteraction, userCancelled, safetyApproved } = request;

  // 1. User Cancellation — Never trigger CUA on explicit cancellation
  if (userCancelled) {
    log.info(`User cancelled execution of ${toolId}; CUA fallback prohibited.`);
    return {
      targetLayer: "NATIVE",
      decision: "CUA_UNAVAILABLE",
      reason: "User cancelled task execution.",
      requiresConfirmation: false,
    };
  }

  // 2. Safety Check — Check tool safety classification
  const commandStr = typeof params?.command === "string" ? params.command : toolId;
  const commandCheck = validateCommand(commandStr);
  const toolSafety = checkToolSafety(toolId);
  
  if (!commandCheck.allowed && safetyApproved === false) {
    log.warn(`Safety policy blocked command execution: ${commandStr} (${commandCheck.reason})`);
    return {
      targetLayer: NATIVE_TOOLS.has(toolId) ? "NATIVE" : "DOM",
      decision: "CUA_UNAVAILABLE",
      reason: `Safety policy blocked command execution: ${commandCheck.reason}`,
      requiresConfirmation: true,
    };
  }

  const requiresConfirmation = commandCheck.requiresConfirmation || toolSafety.requiresConfirmation;

  // 3. Handle Failure Scenarios
  if (failure) {
    // Retryable failure (network timeout, temporary error) -> Stay on current layer, do NOT trigger CUA
    if (failure.isRetryable) {
      log.info(`Retryable failure detected on layer ${failure.attemptedLayer} for ${toolId}; maintaining current layer for retry.`);
      return {
        targetLayer: failure.attemptedLayer,
        decision: "CUA_NOT_REQUIRED",
        reason: `Retryable failure on ${failure.attemptedLayer} layer (${failure.error}); retry before considering CUA.`,
        requiresConfirmation,
      };
    }

    // Permanent non-retryable failure on Native or DOM layer -> Permit CUA fallback if applicable
    if (failure.attemptedLayer === "NATIVE" && DOM_TOOLS.has(toolId)) {
      return {
        targetLayer: "DOM",
        decision: "CUA_NOT_REQUIRED",
        reason: "Native tool execution failed permanently; falling back to structured DOM automation.",
        requiresConfirmation,
      };
    }

    if (failure.attemptedLayer === "DOM" || failure.attemptedLayer === "NATIVE") {
      log.info(`Permanent failure on ${failure.attemptedLayer} layer for ${toolId}; permitting CUA fallback.`);
      return {
        targetLayer: "CUA",
        decision: "CUA_ALLOWED",
        reason: `Permanent failure on ${failure.attemptedLayer} layer (${failure.error}); CUA visual fallback allowed.`,
        requiresConfirmation,
      };
    }
  }

  // 4. Inherent Visual Requirements (e.g. non-standard canvas / coordinate clicks)
  if (requiresVisualInteraction || CUA_VISUAL_TOOLS.has(toolId)) {
    log.info(`Visual interaction required for ${toolId}; routing to CUA layer.`);
    return {
      targetLayer: "CUA",
      decision: "CUA_REQUIRED",
      reason: "Action requires visual coordinate / non-standard UI interaction.",
      requiresConfirmation,
    };
  }

  // 5. Default Precedence: Native → DOM
  if (NATIVE_TOOLS.has(toolId)) {
    return {
      targetLayer: "NATIVE",
      decision: "CUA_NOT_REQUIRED",
      reason: "Native structured tool available.",
      requiresConfirmation,
    };
  }

  if (DOM_TOOLS.has(toolId)) {
    return {
      targetLayer: "DOM",
      decision: "CUA_NOT_REQUIRED",
      reason: "Structured browser DOM tool available.",
      requiresConfirmation,
    };
  }

  // Default fallback if tool is unclassified
  return {
    targetLayer: "NATIVE",
    decision: "CUA_NOT_REQUIRED",
    reason: "Default native execution path.",
    requiresConfirmation,
  };
}
