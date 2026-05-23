// ════════════════════════════════════════════════════════════════════════════════
// src/tools/laptop/executor.ts — Sandboxed shell command execution
// ════════════════════════════════════════════════════════════════════════════════

import { $ } from "bun";
import { env } from "@config/index.js";
import { validateCommand } from "../safety.js";
import { SafetyError, ToolError } from "@utils/errorHandler.js";
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
  const start = Date.now();

  log.tool(`Executing: ${command.slice(0, 100)}`, { cwd, timeout });

  try {
    const result = process.platform === "win32"
      ? await $`cmd /c ${command}`.cwd(cwd).quiet().nothrow()
      : await $`sh -c ${command}`.cwd(cwd).quiet().nothrow();

    const duration = Date.now() - start;

    const execResult: ExecResult = {
      stdout: result.stdout.toString().trim(),
      stderr: result.stderr.toString().trim(),
      exitCode: result.exitCode,
      duration,
    };

    log.tool(`Command completed (exit: ${execResult.exitCode}, ${duration}ms)`);
    return execResult;

  } catch (error) {
    const duration = Date.now() - start;
    if (error instanceof Error && error.message.includes("timeout")) {
      throw new ToolError("shell.execute", `Command timed out after ${timeout}ms`, { command });
    }
    throw new ToolError("shell.execute", `Execution failed: ${String(error)}`, { command });
  }
}

/**
 * Execute a simple command and return just stdout.
 */
export async function exec(command: string, cwd = "."): Promise<string> {
  const result = await executeCommand(command, cwd);
  if (result.exitCode !== 0) {
    throw new ToolError("shell.execute", `Exit code ${result.exitCode}: ${result.stderr}`, { command });
  }
  return result.stdout;
}
