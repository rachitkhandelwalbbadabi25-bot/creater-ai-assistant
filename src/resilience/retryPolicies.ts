// src/resilience/retryPolicies.ts
import { ExecutorConfig } from "../agents/toolExecutor.js";

export const RetryPolicies: Record<string, ExecutorConfig> = {
  api: {
    maxAttempts: 3,
    baseDelayMs: 500,
    timeoutMs: 20000,
  },
  browser: {
    maxAttempts: 3,
    baseDelayMs: 500,
    timeoutMs: 30000,
  },
  shell: {
    maxAttempts: 2,
    baseDelayMs: 200,
    timeoutMs: 15000,
  },
  fileSystem: {
    maxAttempts: 2,
    baseDelayMs: 100,
    timeoutMs: 5000,
  },
  embeddings: {
    maxAttempts: 3,
    baseDelayMs: 500,
    timeoutMs: 15000,
  },
  ollama: {
    maxAttempts: 3,
    baseDelayMs: 1000,
    timeoutMs: 60000,
  },
};
