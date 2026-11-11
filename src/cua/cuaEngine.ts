// ════════════════════════════════════════════════════════════════════════════════
// src/cua/cuaEngine.ts — Advanced CUA Execution Engine (Phase 8)
// Integrates visual grounding, policy evaluation, native desktop controls,
// and closed-loop post-action verification.
// ════════════════════════════════════════════════════════════════════════════════

import { createLogger } from "@utils/logger.js";
import { evaluateCuaPolicy, type CuaPolicyRequest, type CuaPolicyResult } from "./cuaPolicy.js";
import { captureDesktopScreen, captureBrowserViewport, type VisualStateMetadata } from "./screenAnalyzer.js";
import {
  createPointAnchor,
  createBoxAnchor,
  resolveAnchorCoordinates,
  type VisualAnchor,
  type CoordinateSpace,
} from "./visualAnchor.js";
import {
  clickDesktop,
  moveDesktopMouse,
  typeDesktopText,
  pressDesktopKey,
  getActiveDesktopWindow,
  focusDesktopWindow,
  type DesktopActionResult,
} from "../tools/laptop/desktopControl.js";
import { verifyCuaAction, type ExpectedOutcome, type VerificationResult } from "./cuaVerifier.js";
import { tracer } from "../monitoring/tracer.js";

const log = createLogger("cua/engine");

export interface CuaActionRequest {
  action: "click" | "double_click" | "right_click" | "type" | "key" | "focus" | "inspect";
  target?: {
    coordinates?: { x: number; y: number };
    bounds?: { x: number; y: number; width: number; height: number };
    anchor?: VisualAnchor;
    text?: string;
    windowTitle?: string;
  };
  input?: {
    text?: string;
    key?: string;
  };
  verification?: ExpectedOutcome;
  safetyApproved?: boolean;
}

export interface CuaExecutionResult {
  success: boolean;
  action: string;
  policyResult: CuaPolicyResult;
  visualStateBefore?: VisualStateMetadata;
  targetAnchor?: VisualAnchor;
  actionResult?: DesktopActionResult;
  verificationResult?: VerificationResult;
  error?: string;
  durationMs: number;
}

class AdvancedCuaEngine {
  /**
   * Executes a complete closed-loop CUA action:
   * 1. Evaluates CUA Policy (API > DOM > CUA)
   * 2. Inspects current visual state (Active window / Desktop screen)
   * 3. Resolves visual anchor coordinates
   * 4. Executes native desktop mouse/keyboard action
   * 5. Runs post-action verification
   */
  async execute(request: CuaActionRequest): Promise<CuaExecutionResult> {
    const startTime = Date.now();
    log.info(`Initiating CUA action: '${request.action}'`);

    // 1. Evaluate execution policy
    const policyReq: CuaPolicyRequest = {
      toolId: `cua.${request.action}`,
      requiresVisualInteraction: true,
      safetyApproved: request.safetyApproved ?? true,
    };
    const policy = evaluateCuaPolicy(policyReq);

    if (policy.decision === "CUA_UNAVAILABLE") {
      return {
        success: false,
        action: request.action,
        policyResult: policy,
        error: `CUA Policy blocked action: ${policy.reason}`,
        durationMs: Date.now() - startTime,
      };
    }

    return tracer.trace(
      `cua:${request.action}`,
      "tool",
      async () => {
        let visualStateBefore: VisualStateMetadata | undefined;
        let resolvedAnchor: VisualAnchor | undefined;

        // 2. Resolve anchor coordinates
        if (request.target?.anchor) {
          resolvedAnchor = request.target.anchor;
        } else if (request.target?.coordinates) {
          resolvedAnchor = createPointAnchor(
            request.target.coordinates.x,
            request.target.coordinates.y,
            "SCREEN",
            "user_coords"
          );
        } else if (request.target?.bounds) {
          resolvedAnchor = createBoxAnchor(
            request.target.bounds.x,
            request.target.bounds.y,
            request.target.bounds.width,
            request.target.bounds.height,
            "SCREEN",
            "user_bounds"
          );
        }

        // Capture visual state screenshot when verification requires baseline visual diff
        if (request.verification?.type === "visual_change") {
          try {
            const screenInspect = await captureDesktopScreen();
            if (screenInspect.success) {
              visualStateBefore = screenInspect.metadata;
            }
          } catch {
            // Non-blocking visual snapshot
          }
        }

        // 3. Execution of the action
        let actionResult: DesktopActionResult | undefined;

        if (request.action === "click") {
          const coords = resolvedAnchor ? resolveAnchorCoordinates(resolvedAnchor, "SCREEN") : { x: 0, y: 0 };
          actionResult = await clickDesktop(coords.x, coords.y, "left");
        } else if (request.action === "double_click") {
          const coords = resolvedAnchor ? resolveAnchorCoordinates(resolvedAnchor, "SCREEN") : { x: 0, y: 0 };
          actionResult = await clickDesktop(coords.x, coords.y, "double");
        } else if (request.action === "right_click") {
          const coords = resolvedAnchor ? resolveAnchorCoordinates(resolvedAnchor, "SCREEN") : { x: 0, y: 0 };
          actionResult = await clickDesktop(coords.x, coords.y, "right");
        } else if (request.action === "type") {
          const textToType = request.input?.text || request.target?.text || "";
          actionResult = await typeDesktopText(textToType);
        } else if (request.action === "key") {
          const keyToPress = request.input?.key || "{ENTER}";
          actionResult = await pressDesktopKey(keyToPress);
        } else if (request.action === "focus") {
          const winTarget = request.target?.windowTitle || "";
          const focusRes = await focusDesktopWindow(winTarget);
          actionResult = {
            success: focusRes.success,
            action: "focus",
            message: focusRes.message || `Focused window '${focusRes.title || winTarget}'`,
          };
        } else if (request.action === "inspect") {
          const win = await getActiveDesktopWindow();
          actionResult = {
            success: true,
            action: "inspect",
            message: `Active window: '${win.title || "Unknown"}' (PID: ${win.pid})`,
          };
        }

        // 4. Post-action verification
        let verificationResult: VerificationResult | undefined;
        if (request.verification) {
          verificationResult = await verifyCuaAction(request.verification);
        }

        const isSuccess = actionResult?.success ?? true;
        return {
          success: isSuccess,
          action: request.action,
          policyResult: policy,
          visualStateBefore,
          targetAnchor: resolvedAnchor,
          actionResult,
          verificationResult,
          durationMs: Date.now() - startTime,
        };
      },
      { action: request.action }
    );
  }
}

export const advancedCuaEngine = new AdvancedCuaEngine();
