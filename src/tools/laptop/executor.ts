// ════════════════════════════════════════════════════════════════════════════════
// src/tools/laptop/executor.ts — Sandboxed shell command execution (Phase 5.2)
// Wrapped with executeTool() for timeouts, structured failures, and metrics.
// NOTE: Shell commands are NEVER retried (maxAttempts=1) for destructive safety.
// ════════════════════════════════════════════════════════════════════════════════

import { $ } from "bun";
import { env } from "@config/index.js";
import { validateCommand } from "../safety.js";
import { SafetyError, ToolError } from "@utils/errorHandler.js";
import { createLogger } from "@utils/logger.js";
import { executeTool } from "../../agents/toolExecutor.js";
import { recordShellFailure, recordShellSuccess, recordTimeout } from "../toolMetrics.js";

const log = createLogger("tools/executor");

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

// Commands that MUST NEVER be retried (destructive / irreversible)
const NO_RETRY_PATTERNS = [
  /\bdel\b/i,
  /\brm\b/i,
  /\bmove\b/i,
  /\bmv\b/i,
  /\brename\b/i,
  /\bren\b/i,
  /\binstall\b/i,
  /\buninstall\b/i,
  /\btaskkill\b/i,
  /\bkill\b/i,
  /\bkillall\b/i,
  /\bformat\b/i,
  /\brmdir\b/i,
  /\brd\b/i,
];

function isDestructiveCommand(command: string): boolean {
  return NO_RETRY_PATTERNS.some((p) => p.test(command));
}

/**
 * Execute a shell command with safety checks and timeout.
 * maxAttempts is always 1 for destructive commands.
 */
export async function executeCommand(
  command: string,
  cwd = ".",
  timeoutMs?: number
): Promise<ExecResult> {
  const trimmedCommand = typeof command === "string" ? command.trim() : "";

  if (process.platform === "win32" && /^start(?:\s|$)/i.test(trimmedCommand)) {
    throw new ToolError(
      "shell.execute",
      "Windows 'start' launcher commands are disabled. Use system.open_app, system.open_path, or computer.open_browser instead.",
      { command }
    );
  }

  // Safety check
  const safety = validateCommand(command);
  if (!safety.allowed) {
    throw new SafetyError(`Command blocked: ${safety.reason}`, { command });
  }
  if (safety.requiresConfirmation) {
    throw new SafetyError(
      `Command requires confirmation (risk: ${safety.riskLevel}): ${command}`,
      { command, riskLevel: safety.riskLevel }
    );
  }

  const timeout = timeoutMs ?? env.MAX_SHELL_TIMEOUT_MS;
  const destructive = isDestructiveCommand(command);
  const maxAttempts = destructive ? 1 : 1; // Always 1 for shell — safety rule

  const start = Date.now();
  console.log("[SHELL_EXECUTION_START]", command.slice(0, 100));
  log.tool(`Executing: ${command.slice(0, 100)}`, { cwd, timeout, destructive });

  const res = await executeTool(
    async () => {
      const result =
        process.platform === "win32"
          ? await $`cmd /c ${command}`.cwd(cwd).quiet().nothrow()
          : await $`sh -c ${command}`.cwd(cwd).quiet().nothrow();

      return {
        stdout: result.stdout.toString().trim(),
        stderr: result.stderr.toString().trim(),
        exitCode: result.exitCode,
        duration: Date.now() - start,
      } as ExecResult;
    },
    { maxAttempts, timeoutMs: timeout }
  );

  if (res.success) {
    const execResult = res.result as ExecResult;
    console.log(
      "[SHELL_EXECUTION_SUCCESS]",
      `exit=${execResult.exitCode}`,
      `${execResult.duration}ms`
    );
    recordShellSuccess(execResult.duration);
    log.tool(`Command completed (exit: ${execResult.exitCode}, ${execResult.duration}ms)`);
    return execResult;
  }

  // Failure path
  const duration = Date.now() - start;
  console.log("[SHELL_EXECUTION_FAILED]", res.error);
  if (res.error?.includes("timeout")) {
    recordTimeout();
    recordShellFailure();
    throw new ToolError("shell.execute", `Command timed out after ${timeout}ms`, { command });
  }

  recordShellFailure();
  throw new ToolError("shell.execute", `Execution failed: ${res.error}`, { command });
}

/**
 * Execute a simple command and return just stdout.
 */
export async function exec(command: string, cwd = "."): Promise<string> {
  const result = await executeCommand(command, cwd);
  if (result.exitCode !== 0) {
    throw new ToolError(
      "shell.execute",
      `Exit code ${result.exitCode}: ${result.stderr}`,
      { command }
    );
  }
  return result.stdout;
}
