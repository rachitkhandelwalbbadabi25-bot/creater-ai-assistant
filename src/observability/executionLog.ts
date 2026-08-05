// src/observability/executionLog.ts
/**
 * Execution logging utilities.
 * Writes JSONL entries to dedicated log files inside the `logs/` directory.
 * Directories are created on demand and logs are appended in a deterministic order.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface ExecutionLogEntry {
  timestamp: string; // ISO timestamp, added automatically
  taskId?: string;
  stepId?: string;
  correlationId?: string;
  module?: string;
  action: string;
  durationMs?: number;
  status: 'running' | 'success' | 'failed';
  error?: unknown;
  metadata?: Record<string, unknown>;
}

/** Serialize an error safely for JSON output */
export function serializeError(err: unknown): unknown {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  return err; // primitives or plain objects are fine
}

// Base log directory (project root)
const LOG_ROOT = path.resolve('logs');
const LOG_PATHS = {
  execution: path.join(LOG_ROOT, 'execution', 'execution.log.jsonl'),
  workflow: path.join(LOG_ROOT, 'workflow', 'workflow.log.jsonl'),
  browser: path.join(LOG_ROOT, 'browser', 'browser.log.jsonl'),
  errors: path.join(LOG_ROOT, 'errors', 'errors.log.jsonl'),
} as const;

/** Ensure that a directory exists */
function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Internal helper to write a log entry (adds timestamp) */
function write(entry: Omit<ExecutionLogEntry, 'timestamp'>, sub: keyof typeof LOG_PATHS): void {
  const full: ExecutionLogEntry = { timestamp: new Date().toISOString(), ...entry };
  // Serialize error safely
  if (full.error) {
    full.error = serializeError(full.error);
  }
  const line = JSON.stringify(full) + '\n';
  const target = LOG_PATHS[sub];
  ensureDir(target);
  fs.appendFileSync(target, line, { encoding: 'utf8' });
}

/** Public logging functions */
export function logExecution(entry: Omit<ExecutionLogEntry, 'timestamp'>): void {
  write(entry, 'execution');
}
export function logWorkflow(entry: Omit<ExecutionLogEntry, 'timestamp'>): void {
  write(entry, 'workflow');
}
export function logBrowser(entry: Omit<ExecutionLogEntry, 'timestamp'>): void {
  write(entry, 'browser');
}
export function logError(entry: Omit<ExecutionLogEntry, 'timestamp'>): void {
  write(entry, 'errors');
}

// Export paths for tests
export const LOG_FILES = LOG_PATHS;
