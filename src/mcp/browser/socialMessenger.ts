// ════════════════════════════════════════════════════════════════════════════════
// src/mcp/browser/socialMessenger.ts — Social Messaging Compatibility Adapter
// Forwards social messaging commands directly to the Universal Autonomous Web Operator
// ════════════════════════════════════════════════════════════════════════════════

import { runAutonomousWebTask, type AutonomousWebTaskResult } from "./universalWebOperator.js";

export interface SocialMessageRequest {
  platform: "linkedin" | "instagram" | "whatsapp" | "twitter" | "telegram" | string;
  recipient: string;
  message: string;
  dryRun?: boolean;
}

export interface SocialMessageResult {
  success: boolean;
  platform: string;
  recipient: string;
  message: string;
  method: "UNIVERSAL_WEB_OPERATOR" | "CUA_DESKTOP_FALLBACK" | "DRY_RUN";
  details: string;
  error?: string;
}

/**
 * Executes a social messaging request via the Universal Autonomous Web Operator.
 */
export async function sendSocialMessage(request: SocialMessageRequest): Promise<SocialMessageResult> {
  const goal = `Send message to ${request.recipient} on ${request.platform}: ${request.message}`;

  const res: AutonomousWebTaskResult = await runAutonomousWebTask({
    goal,
    dryRun: request.dryRun,
  });

  return {
    success: res.success,
    platform: request.platform,
    recipient: request.recipient,
    message: request.message,
    method: res.method,
    details: res.summary,
    error: res.error,
  };
}

