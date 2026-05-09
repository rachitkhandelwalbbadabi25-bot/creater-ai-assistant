// ════════════════════════════════════════════════════════════════════════════════
// src/tools/safety.ts — Risk checker, command validation, and user confirmation
// ════════════════════════════════════════════════════════════════════════════════

import { env, confirmationRequiredFor } from "@config/index.js";
import { getToolById, requiresConfirmation, type ToolDefinition } from "@config/tools.js";
import { SafetyError } from "@utils/errorHandler.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("tools/safety");

// ─── Dangerous command patterns (always blocked or require confirmation) ──────────
const BLOCKED_COMMANDS = [
  /rm\s+-rf\s+\//, // rm -rf /
  /format\s+[a-z]:/i, // format C:
  /del\s+.*\/s\s+/i, // del /s (Windows recursive delete)
  /rd\s+.*\/s\s+/i,  // rd /s (Windows recursive directory delete)
  /mkfs\./,
  /dd\s+if=.*of=\/dev/,
  /shutdown/i,
  /reboot/i,
  /:(){ :\|:& };:/, // fork bomb
  />\s*\/dev\/sd/, // overwrite disk
  /net\s+user\s+.*\/delete/i, // delete user
  /net\s+localgroup\s+administrators\s+.*\/add/i, // add to admin
];

const SUSPICIOUS_PATTERNS = [
  /sudo\s+/,
  /chmod\s+777/,
  /curl.*\|\s*sh/,   // pipe curl to shell
  /wget.*\|\s*bash/,
  /eval\s*\(/,
  /rm\s+-rf/,
  /del\s+\/f/i,
  /powershell.*-enc/i, // encoded powershell
  /reg\s+delete/i,
  /taskkill\s+\/f/i,
  /net\s+stop/i,
  /sc\s+delete/i,
  /attrib\s+-r/i,
  /cmd\s+\/c/i,
];

export type RiskLevel = "safe" | "low" | "medium" | "high" | "critical";

export interface SafetyCheck {
  allowed: boolean;
  riskLevel: RiskLevel;
  reason: string;
  requiresConfirmation: boolean;
}

/**
 * Validate a shell command before execution.
 */
export function validateCommand(command: string): SafetyCheck {
  const cmd = command.trim();

  // Check blocked commands (always denied)
  for (const pattern of BLOCKED_COMMANDS) {
    if (pattern.test(cmd)) {
      log.warn(`BLOCKED dangerous command: ${cmd.slice(0, 80)}`);
      return {
        allowed: false,
        riskLevel: "critical",
        reason: `Command matches blocked pattern: ${pattern.source}`,
        requiresConfirmation: false,
      };
    }
  }

  // Check suspicious patterns
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(cmd)) {
      log.warn(`Suspicious command detected: ${cmd.slice(0, 80)}`);
      return {
        allowed: true,
        riskLevel: "high",
        reason: `Suspicious pattern: ${pattern.source}`,
        requiresConfirmation: true,
      };
    }
  }

  // Check safety mode
  const mode = env.SAFETY_MODE;
  if (mode === "strict" && confirmationRequiredFor.includes("shell")) {
    return {
      allowed: true,
      riskLevel: "medium",
      reason: "Strict mode — all shell commands require confirmation",
      requiresConfirmation: true,
    };
  }

  return { allowed: true, riskLevel: "safe", reason: "Command looks safe", requiresConfirmation: false };
}

/**
 * Validate a file operation.
 */
export function validateFileOp(operation: "read" | "write" | "delete", path: string): SafetyCheck {
  const protectedPaths = [
    /^[A-Z]:\\Windows/i,
    /^\/etc\//,
    /^\/usr\//,
    /^\/sys\//,
    /System32/i,
    /\.ssh/,
    /\.env$/,
    /\.git\/config$/,
  ];

  for (const pattern of protectedPaths) {
    if (pattern.test(path)) {
      if (operation === "delete") {
        return { allowed: false, riskLevel: "critical", reason: `Cannot delete protected path: ${path}`, requiresConfirmation: false };
      }
      if (operation === "write") {
        return { allowed: true, riskLevel: "high", reason: `Writing to sensitive path: ${path}`, requiresConfirmation: true };
      }
    }
  }

  if (operation === "delete") {
    return { allowed: true, riskLevel: "medium", reason: "File deletion", requiresConfirmation: env.SAFETY_MODE === "strict" };
  }

  return { allowed: true, riskLevel: "safe", reason: "OK", requiresConfirmation: false };
}

/**
 * Check if a tool requires confirmation based on current safety mode.
 */
export function checkToolSafety(toolId: string): SafetyCheck {
  const tool = getToolById(toolId);
  if (!tool) {
    return { allowed: false, riskLevel: "high", reason: `Unknown tool: ${toolId}`, requiresConfirmation: false };
  }

  const needsConfirm = requiresConfirmation(tool, env.SAFETY_MODE as "strict" | "moderate" | "permissive");

  return {
    allowed: true,
    riskLevel: tool.permission === "dangerous" ? "high" : tool.permission === "sensitive" ? "medium" : "safe",
    reason: `Tool permission: ${tool.permission}`,
    requiresConfirmation: needsConfirm,
  };
}
