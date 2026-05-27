// ════════════════════════════════════════════════════════════════════════════════
// src/tools/laptop/executor.ts — Sandboxed shell command execution
// ════════════════════════════════════════════════════════════════════════════════

import { ToolError } from "@utils/errorHandler.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("tools/executor");

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

/**
 * Execute a shell command with safety checks and timeout.
 */
export async function executeCommand(
  command: string,
  cwd = ".",
  timeoutMs?: number
): Promise<ExecResult> {
  console.log("[SHELL EXECUTION BLOCKED]", "src/tools/laptop/executor.ts", "executeCommand", command);
  log.warn("Shell execution disabled during stabilization", { command, cwd, timeoutMs });
  throw new ToolError("shell.execute", "Shell execution disabled during stabilization", {
    command,
    cwd,
    timeoutMs,
  });
}

/**
 * Execute a simple command and return just stdout.
 */
export async function exec(command: string, cwd = "."): Promise<string> {
  await executeCommand(command, cwd);
  throw new ToolError("shell.execute", "Shell execution disabled during stabilization", { command, cwd });
}
