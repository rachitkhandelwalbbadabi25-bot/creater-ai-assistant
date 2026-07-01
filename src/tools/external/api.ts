// ════════════════════════════════════════════════════════════════════════════════
// src/tools/external/api.ts — External API client (Phase 5.3)
// Wrapped with executeTool() for retries, timeouts, error classification,
// metrics, structured logging, and supervisor-safe recovery.
// ════════════════════════════════════════════════════════════════════════════════

import axios, { type AxiosRequestConfig } from "axios";
import { createLogger } from "@utils/logger.js";
import { ToolError } from "@utils/errorHandler.js";
import { executeTool } from "../../agents/toolExecutor.js";
import {
  recordApiRetry,
  recordApiFailure,
  recordApiSuccess,
  recordRateLimitHit,
  recordApiTimeout,
} from "../toolMetrics.js";

const log = createLogger("tools/api");

// ─── Default retry policies ───────────────────────────────────────────────────

const HTTP_POLICY   = { maxAttempts: 3, baseDelayMs: 500,  timeoutMs: 20000 };
const LLM_POLICY    = { maxAttempts: 3, baseDelayMs: 1000, timeoutMs: 60000 };
const WEBHOOK_POLICY = { maxAttempts: 2, baseDelayMs: 1000, timeoutMs: 15000 };

// ─── HTTP Status Classification (Step 3) ─────────────────────────────────────

/** Returns true if the HTTP status is transient and worth retrying. */
export function isTransientHttpStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/** Returns true if the HTTP status is a permanent/fatal client error. */
export function isFatalHttpStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404;
}

/** Classify a raw error into transient vs fatal for executeTool. */
function classifyApiError(err: unknown): { retryable: boolean; isRateLimit: boolean; isTimeout: boolean } {
  if (!(err instanceof Error)) {
    return { retryable: true, isRateLimit: false, isTimeout: false };
  }

  const msg = err.message.toLowerCase();

  // Timeout patterns
  const isTimeout =
    msg.includes("timeout") ||
    msg.includes("etimedout") ||
    msg.includes("econnaborted");

  // Rate limit
  const isRateLimit = msg.includes("429") || msg.includes("rate limit") || msg.includes("too many requests");

  // Transient network errors
  const isTransientNetwork =
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("dns") ||
    msg.includes("enotfound") ||
    msg.includes("network") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504");

  // Fatal client errors
  const isFatal =
    msg.includes("400") ||
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("404") ||
    msg.includes("invalid") ||
    msg.includes("unauthorized") ||
    msg.includes("forbidden") ||
    msg.includes("not found");

  if (isFatal && !isTransientNetwork && !isRateLimit && !isTimeout) {
    return { retryable: false, isRateLimit: false, isTimeout };
  }

  return {
    retryable: isTimeout || isTransientNetwork || isRateLimit,
    isRateLimit,
    isTimeout,
  };
}

// ─── Internal wrapper ─────────────────────────────────────────────────────────

async function withApiRetry<T>(
  operationName: string,
  fn: () => Promise<T>,
  policy = HTTP_POLICY
): Promise<T> {
  const start = Date.now();
  console.log(`[API_REQUEST_START] ${operationName}`);

  let attempts = 0;

  const res = await executeTool(
    async () => {
      attempts++;
      if (attempts > 1) {
        console.log(`[API_RETRY_START] ${operationName} attempt ${attempts}`);
        recordApiRetry();
      }
      return fn();
    },
    policy
  );

  if (res.success) {
    const ms = Date.now() - start;
    console.log(`[API_REQUEST_SUCCESS] ${operationName} (${ms}ms)`);
    if (attempts > 1) console.log(`[API_RETRY_SUCCESS] ${operationName}`);
    recordApiSuccess(ms);
    return res.result as T;
  }

  // Classify and record the error
  const classification = classifyApiError(new Error(res.error ?? ""));
  if (classification.isRateLimit) {
    console.log(`[RATE_LIMIT_DETECTED] ${operationName}`);
    recordRateLimitHit();
  }
  if (classification.isTimeout) {
    recordApiTimeout();
  }

  console.log(`[API_REQUEST_FAILED] ${operationName}`, res.error);
  if (attempts > 1) console.log(`[API_RETRY_FAILED] ${operationName}`);
  recordApiFailure();

  // Supervisor-safe: throw structured error, never crash
  throw new ToolError(
    operationName,
    res.error ?? `${operationName} failed after ${attempts} attempts`,
    { attempts }
  );
}

// ─── Public HTTP API ──────────────────────────────────────────────────────────

export async function httpGet(
  url: string,
  headers?: Record<string, string>
): Promise<unknown> {
  log.tool(`GET ${url}`);
  return withApiRetry(`http.get:${url}`, async () => {
    const resp = await axios.get(url, { headers, timeout: 15000 } as AxiosRequestConfig);
    if (resp.status && isTransientHttpStatus(resp.status)) {
      throw new Error(`HTTP ${resp.status}: transient server error`);
    }
    if (resp.status && isFatalHttpStatus(resp.status)) {
      throw new Error(`HTTP ${resp.status}: fatal client error`);
    }
    return resp.data;
  });
}

export async function httpPost(
  url: string,
  data: unknown,
  headers?: Record<string, string>
): Promise<unknown> {
  log.tool(`POST ${url}`);
  return withApiRetry(`http.post:${url}`, async () => {
    const resp = await axios.post(url, data, {
      headers,
      timeout: 15000,
    } as AxiosRequestConfig);
    if (resp.status && isTransientHttpStatus(resp.status)) {
      throw new Error(`HTTP ${resp.status}: transient server error`);
    }
    if (resp.status && isFatalHttpStatus(resp.status)) {
      throw new Error(`HTTP ${resp.status}: fatal client error`);
    }
    return resp.data;
  });
}

export async function httpPut(
  url: string,
  data: unknown,
  headers?: Record<string, string>
): Promise<unknown> {
  log.tool(`PUT ${url}`);
  return withApiRetry(`http.put:${url}`, async () => {
    const resp = await axios.put(url, data, {
      headers,
      timeout: 15000,
    } as AxiosRequestConfig);
    if (resp.status && isTransientHttpStatus(resp.status)) {
      throw new Error(`HTTP ${resp.status}: transient server error`);
    }
    return resp.data;
  });
}

export async function httpDelete(
  url: string,
  headers?: Record<string, string>
): Promise<unknown> {
  log.tool(`DELETE ${url}`);
  // Deletes are never retried — destructive
  return withApiRetry(
    `http.delete:${url}`,
    async () => {
      const resp = await axios.delete(url, { headers, timeout: 15000 } as AxiosRequestConfig);
      return resp.data;
    },
    { maxAttempts: 1, baseDelayMs: 0, timeoutMs: 15000 }
  );
}

export async function sendWebhook(
  url: string,
  payload: unknown,
  headers?: Record<string, string>
): Promise<unknown> {
  log.tool(`WEBHOOK → ${url}`);
  return withApiRetry(
    `webhook:${url}`,
    async () => {
      const resp = await axios.post(url, payload, {
        headers: { "Content-Type": "application/json", ...headers },
        timeout: 10000,
      } as AxiosRequestConfig);
      return resp.data;
    },
    WEBHOOK_POLICY
  );
}

// ─── LLM API Safety Layer (Step 7) ───────────────────────────────────────────

/**
 * Wrap any LLM provider call (Ollama, OpenAI, Anthropic, Gemini) with
 * the LLM retry policy: maxAttempts=3, baseDelayMs=1000, timeoutMs=60000.
 */
export async function withLlmApiRetry<T>(
  operationName: string,
  fn: () => Promise<T>
): Promise<T> {
  return withApiRetry(operationName, fn, LLM_POLICY);
}

/**
 * Convenience wrapper for Ollama-specific requests (chat, embed, pull).
 */
export async function withOllamaRetry<T>(
  operationName: string,
  fn: () => Promise<T>
): Promise<T> {
  return withApiRetry(
    `ollama.${operationName}`,
    fn,
    { maxAttempts: 3, baseDelayMs: 1000, timeoutMs: 60000 }
  );
}
