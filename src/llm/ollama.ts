// -------------------------------------------------------------------------------
// src/llm/ollama.ts - Ollama client wrapper with lifecycle logging and mutex
// -------------------------------------------------------------------------------

import { Ollama } from "ollama";
import { isDev, env } from "@config/index.js";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import * as path from "path";
import { createLogger } from "@utils/logger.js";
import type { ChatResponse } from "ollama";
import type { GenerationOptions } from "@config/models.js";
import { LLMError, safeAsync, type Result, withRetry } from "@utils/errorHandler.js";
import { withTimeout } from "@utils/helpers.js";
import { latencyTracker } from "@utils/latencyTracker.js";
import { execSync } from "child_process";

const MODULE_INSTANCE_ID = Math.random().toString(36).slice(2);
console.log("[MODULE_INSTANCE]", { file: "ollama.ts", event: "load", id: MODULE_INSTANCE_ID });

const log = createLogger("llm/ollama");

const client = new Ollama({ host: env.OLLAMA_BASE_URL });
log.info("Ollama client initialized", {
  host: env.OLLAMA_BASE_URL,
  timeoutMs: env.OLLAMA_TIMEOUT_MS,
});

// ─── State Variables for Queueing & Latency ──────────────────────────────────────
let queueTail: Promise<void> = Promise.resolve();
let requestId = "";
let activeOperations = 0;
let startedAt = 0;
let operationSeq = 0;

// Global latency tracker map (requestId -> stages)
const latencyMap = new Map<string, Record<string, number>>();
let __currentRequestId = "";

type OllamaWarmupState = {
  started: boolean;
  completed: boolean;
  inFlight: boolean;
  abortController?: AbortController;
  promise?: Promise<void>;
};

const warmupStateKey = Symbol.for("creater.ollama.warmupState");
const globalWithWarmup = globalThis as typeof globalThis & {
  [warmupStateKey]?: OllamaWarmupState;
};
const warmupState =
  globalWithWarmup[warmupStateKey] ??
  (globalWithWarmup[warmupStateKey] = {
    started: false,
    completed: false,
    inFlight: false,
  });

// ─── Model Warmup ────────────────────────────────────────────────────────────────
// Pre-loads the primary model into Ollama's RAM immediately after startup.
// Runs outside the app-level Ollama mutex and is cancelled as soon as real
// generation work arrives, so user traffic always has priority.
async function warmupModel(model: string): Promise<void> {
  const abortController = new AbortController();
  warmupState.abortController = abortController;
  warmupState.inFlight = true;

  try {
    log.info("Warming up model (pre-loading into RAM)...", { model });
    await client.chat({
      model,
      messages: [{ role: "user", content: "hi" }],
      options: { num_predict: 1, num_ctx: 2048 },
      keep_alive: env.OLLAMA_KEEP_ALIVE,
      signal: abortController.signal,
      stream: false,
    } as any);
    warmupState.completed = true;
    log.info("Model warmup complete — ready for fast responses", { model });
  } catch (err) {
    if (abortController.signal.aborted) {
      log.info("Model warmup cancelled in favor of user request", { model });
      return;
    }

    log.warn("Model warmup failed (non-fatal — will load on first request)", {
      model,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    warmupState.inFlight = false;
    if (warmupState.abortController === abortController) {
      warmupState.abortController = undefined;
    }
  }
}

export function startOllamaWarmup(model = env.OLLAMA_PRIMARY_MODEL || "qwen2.5:3b"): void {
  // Respect user-configurable flag to disable automatic model warmup. This prevents the warmup
  // process from running during startup when not needed, which can interfere with request latency
  // and cause the "llama runner process has terminated" instability in certain environments.
  if (!env.ENABLE_OLLAMA_WARMUP) {
    log.info("Ollama warmup disabled via ENABLE_OLLAMA_WARMUP flag");
    return;
  }

  if (warmupState.started) {
    log.debug("Ollama warmup already scheduled", {
      model,
      completed: warmupState.completed,
      inFlight: warmupState.inFlight,
    });
    return;
  }

  warmupState.started = true;
  warmupState.promise = warmupModel(model);
}

function cancelOllamaWarmup(reason: string): void {
  if (!warmupState.inFlight || !warmupState.abortController || warmupState.abortController.signal.aborted) {
    return;
  }

  log.info("Cancelling Ollama warmup", { reason });
  warmupState.abortController.abort();
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function cleanMessage(message: string): string {
  return message.replace(/%!w\(<nil>\)/g, "").replace(/\s{2,}/g, " ").trim();
}

function getErrorContext(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { error: String(error) };
  }

  const anyError = error as Error & Record<string, unknown>;
  return {
    name: error.name,
    message: cleanMessage(error.message),
    stack: error.stack,
    code: anyError.code,
    status: anyError.status,
    cause:
      anyError.cause instanceof Error
        ? { message: anyError.cause.message, stack: anyError.cause.stack }
        : anyError.cause,
    response: anyError.response,
    body: anyError.body,
  };
}

function normalizeOllamaError(error: unknown, context: Record<string, unknown>): LLMError {
  const message = cleanMessage(toError(error).message) || "Ollama request failed";
  return new LLMError(message, { ...context, ...getErrorContext(error) });
}

// ─── Rule 8: Runner Crash Diagnostics ────────────────────────────────────────
// When "llama runner process has terminated" is detected, capture full
// diagnostics. DO NOT kill/restart the runner — diagnostics only.
async function captureRunnerCrashDiagnostics(
  context: {
    payloadChars: number;
    messageCount: number;
    model: string;
    options?: Record<string, unknown>;
  }
): Promise<void> {
  const mem = process.memoryUsage();

  let ollamaPs = "(failed to run)";
  try {
    ollamaPs = execSync("ollama ps", { timeout: 3000 }).toString().trim();
  } catch {
    ollamaPs = "(ollama ps unavailable)";
  }

  const diagnostics = {
    timestamp: new Date().toISOString(),
    event: "RUNNER_CRASH",
    model: context.model,
    activeOperations,
    payloadChars: context.payloadChars,
    messageCount: context.messageCount,
    num_predict: (context.options as any)?.num_predict ?? "(not set)",
    keep_alive: env.OLLAMA_KEEP_ALIVE,
    memory_rss_mb: Math.round(mem.rss / 1024 / 1024),
    memory_heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
    memory_heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
    memory_external_mb: Math.round(mem.external / 1024 / 1024),
    ollama_ps: ollamaPs,
  };

  // Log to console so it appears in captured logs
  console.error("[RUNNER_CRASH_DIAGNOSTICS]", JSON.stringify(diagnostics, null, 2));
  log.error("Ollama runner crash captured — diagnostics logged", diagnostics);

  // Also append to a diagnostics file for post-mortem inspection
  try {
    const diagPath = path.join(process.cwd(), "logs", "runner_crashes.jsonl");
    fs.mkdirSync(path.dirname(diagPath), { recursive: true });
    fs.appendFileSync(diagPath, JSON.stringify(diagnostics) + "\n", "utf8");
  } catch {
    // Non-fatal — don't let file write failure cascade
  }
}

function isRunnerCrashError(error: unknown): boolean {
  const msg = toError(error).message.toLowerCase();
  return msg.includes("llama runner process has terminated") ||
    msg.includes("runner process") ||
    msg.includes("runner terminated");
}

function logPromptAudit(messages: ChatMessage[]): void {
  console.log("[PROMPT_AUDIT]", {
    messageCount: messages.length,
    payloadChars: JSON.stringify(messages).length,
    messages,
  });
}

type OllamaRuntimeOptions = Partial<GenerationOptions> & {
  num_ctx?: number;
};

function summarizeOllamaOptions(options?: OllamaRuntimeOptions): Record<string, unknown> {
  return {
    num_ctx: options?.num_ctx,
    num_predict: options?.num_predict,
    temperature: options?.temperature,
    top_p: options?.top_p,
    top_k: options?.top_k,
    repeat_penalty: options?.repeat_penalty,
    stop: options?.stop,
  };
}

function logOllamaRequestShape(
  operation: "chat" | "chatStream" | "generate",
  payload: {
    model: string;
    stream: boolean;
    keepAlive?: string;
    options?: OllamaRuntimeOptions;
    messages?: ChatMessage[];
    prompt?: string;
  }
): void {
  console.log("[OLLAMA_REQUEST_SHAPE]", {
    operation,
    model: payload.model,
    stream: payload.stream,
    keep_alive: payload.keepAlive,
    options: summarizeOllamaOptions(payload.options),
    messageCount: payload.messages?.length,
    payloadChars:
      payload.messages != null
        ? JSON.stringify(payload.messages).length
        : payload.prompt?.length,
  });
}

function logOllamaFinalStats(chunk: unknown): void {
  const stats = chunk as Record<string, unknown>;
  const loadNs = Number(stats.load_duration ?? 0);
  const promptNs = Number(stats.prompt_eval_duration ?? 0);
  const evalNs = Number(stats.eval_duration ?? 0);
  const totalNs = Number(stats.total_duration ?? 0);
  const accountedNs = loadNs + promptNs + evalNs;

  console.log("[OLLAMA_FINAL_STATS]", {
    load_duration: stats.load_duration,
    prompt_eval_count: stats.prompt_eval_count,
    prompt_eval_duration: stats.prompt_eval_duration,
    eval_count: stats.eval_count,
    eval_duration: stats.eval_duration,
    total_duration: stats.total_duration,
    load_ms: Math.round(loadNs / 1e6),
    prompt_eval_ms: Math.round(promptNs / 1e6),
    eval_ms: Math.round(evalNs / 1e6),
    total_ms: Math.round(totalNs / 1e6),
    non_eval_overhead_ms: Math.round(Math.max(0, totalNs - accountedNs) / 1e6),
  });
}

// Corrected withOllamaLock implementation with proper error handling and latency tracking
async function withOllamaLock<T>(
  operation: string,
  context: Record<string, unknown>,
  task: () => Promise<T>
): Promise<T> {
  requestId = `${operation}-${++operationSeq}`;
  console.log("[MODULE_INSTANCE]", { file: "ollama.ts", event: "start", id: MODULE_INSTANCE_ID, requestId });
  const queuedAt = Date.now();

  // Initialize latency record if auditing enabled
  if (env.ENABLE_LATENCY_AUDIT) {
    latencyMap.set(requestId, {
      lockWait: 0,
      queueWait: 0,
      httpStart: 0,
      firstToken: 0,
      generation: 0,
      streamComplete: 0,
    });
  }

  // REQUEST_START log
  if (isDev) log.debug('[REQUEST_START]', { requestId, operation, ...context });

  // Queue handling (simple mutex using promise chain)
  const waitForTurn = queueTail;
  let release!: () => void;
  queueTail = new Promise<void>((resolve) => {
    release = resolve;
  });

  await waitForTurn;

  // Record queue wait duration
  const queueWait = Date.now() - queuedAt;
  if (env.ENABLE_LATENCY_AUDIT) {
    const map = latencyMap.get(requestId);
    if (map) map.queueWait = queueWait;
  }

  activeOperations++;
  startedAt = Date.now();
  // Record lock wait duration (time after queue release before start)
  const lockWait = startedAt - queuedAt - queueWait;
  if (env.ENABLE_LATENCY_AUDIT) {
    const map = latencyMap.get(requestId);
    if (map) map.lockWait = lockWait;
  }

  log.info("Ollama operation started", {
    requestId,
    operation,
    waitMs: Date.now() - queuedAt,
    activeOperations,
    ...context,
  });


  try {
    const result = await task();

    // Record total generation duration
    if (env.ENABLE_LATENCY_AUDIT) {
      const map = latencyMap.get(requestId);
      if (map) map.generation = Date.now() - startedAt;
    }

    // Write report and clean up
    if (env.ENABLE_LATENCY_AUDIT) {
      latencyTracker.report(requestId, latencyMap.get(requestId) ?? {});
      latencyMap.delete(requestId);
    }

    return result;
  } catch (error) {
    const normalized = normalizeOllamaError(error, {
      requestId,
      operation,
      durationMs: Date.now() - startedAt,
      ...context,
    });
    log.error("Ollama operation failed", normalized, {
      requestId,
      operation,
      ...getErrorContext(error),
      ...context,
    });
    throw normalized;
  } finally {
    console.log("[MODULE_INSTANCE]", { file: "ollama.ts", event: "end", id: MODULE_INSTANCE_ID, requestId });
    activeOperations = Math.max(0, activeOperations - 1);
    release();
  }
}



async function listOllamaModels(): Promise<string[]> {
  const response = await withTimeout(client.list(), 5000, "Ollama health check");
  return (response as any).models.map((m: any) => m.name);
}

// -------------------------------------------------------------------------------
// Health Check
// -------------------------------------------------------------------------------

export async function checkOllamaHealth(): Promise<Result<string[]>> {
  return safeAsync(async () => {
    return await withOllamaLock("health", { host: env.OLLAMA_BASE_URL }, async () => {
      if (isDev) log.debug('[HEALTH_CHECK_START]');
      const modelNames = await listOllamaModels();
      log.info("Ollama startup check complete", { modelCount: modelNames.length, models: modelNames });
      if (isDev) log.debug('[HEALTH_CHECK_END]');
      return modelNames;
    });
  });
}

export async function ensureModel(modelName: string): Promise<void> {
  await withOllamaLock('ensureModel', { modelName }, async () => {
    if (isDev) log.debug('[ENSURE_MODEL_START]', { requestId, pid: process.pid, modelName });
    
    const models = await listOllamaModels();
    const hasTag = modelName.includes(":");
    const normalizedName = hasTag ? modelName : `${modelName}:latest`;
    const exists = models.some(m => {
      const mNorm = m.includes(":") ? m : `${m}:latest`;
      return mNorm.toLowerCase() === normalizedName.toLowerCase() || m.toLowerCase() === modelName.toLowerCase();
    });

    if (!exists) {
      if (isDev) log.debug('Model pull starting', { modelName });
      log.info("Model pull started", { modelName });
      const stream = await client.pull({ model: modelName, stream: true });
      for await (const part of stream as AsyncIterable<{ status?: string; completed?: number; total?: number }>) {
        if (part.completed && part.total) {
          const percent = ((part.completed / part.total) * 100).toFixed(1);
          log.info(`Pull progress for ${modelName}: ${percent}% (${part.status})`);
        } else if (part.status) {
          log.info(`Pull status for ${modelName}: ${part.status}`);
        }
      }
      log.info("Model pull ended", { modelName });
      if (isDev) log.debug('Model pull completed', { modelName });
    }
    
    if (isDev) log.debug('[ENSURE_MODEL_END]', { requestId, pid: process.pid, modelName });
  });
}

// -------------------------------------------------------------------------------
// Chat Completion
// -------------------------------------------------------------------------------

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  options?: Partial<GenerationOptions>;
  format?: "json";
  stream?: false;
}

export async function chat(opts: ChatOptions): Promise<string> {
  cancelOllamaWarmup("chat request started");
  await ensureModel(opts.model);

  log.llm("Prompt received", {
    operation: "chat",
    model: opts.model,
    messageCount: opts.messages.length,
    lastMsg: opts.messages[opts.messages.length - 1]?.content.slice(0, 100),
    format: opts.format ?? "text",
  });

  return await withOllamaLock("chat", { model: opts.model, messageCount: opts.messages.length }, async () => {
    const response = await withRetry(
      async () => {
        log.info("Chat inference started", {
          model: opts.model,
          messageCount: opts.messages.length,
          stream: false,
        });

        // Record HTTP request start (just before actual client call)
        if (env.ENABLE_LATENCY_AUDIT) {
          const map = latencyMap.get(requestId);
          if (map) map.httpStart = Date.now() - startedAt;
        }

        logPromptAudit(opts.messages);
        logOllamaRequestShape("chat", {
          model: opts.model,
          stream: false,
          keepAlive: env.OLLAMA_KEEP_ALIVE,
          options: opts.options,
          messages: opts.messages,
        });
        const t0 = performance.now();
        const result = await withTimeout(
          client.chat({
            model: opts.model,
            messages: opts.messages,
            options: opts.options,
            format: opts.format,
            keep_alive: env.OLLAMA_KEEP_ALIVE,
            stream: false,
          } as any),
          env.OLLAMA_TIMEOUT_MS,
          `Chat with ${opts.model}`
        );
        console.log("[NON_STREAM_TOTAL_MS]", Math.round(performance.now() - t0));
        return result as unknown as ChatResponse;
      },
      2,
      1000
    );

    const content = response.message?.content ?? "";
    const trimmed = content.trim();
    logOllamaFinalStats(response);

    log.info("Chat inference ended", {
      model: opts.model,
      tokens: response.eval_count,
      duration:
        response.total_duration != null
          ? `${(Number(response.total_duration) / 1e9).toFixed(2)}s`
          : "unknown",
      stream: false,
    });

    return content.trim();
  });
}
export async function chatStream(
  opts: Omit<ChatOptions, "stream">,
  onToken: (token: string) => void
): Promise<string> {
  cancelOllamaWarmup("chat stream request started");
  await ensureModel(opts.model);

  log.llm("Prompt received", {
    operation: "chatStream",
    model: opts.model,
    messageCount: opts.messages.length,
    lastMsg: opts.messages[opts.messages.length - 1]?.content.slice(0, 100),
    stream: true,
  });
  console.log("MESSAGE COUNT:", opts.messages.length);

  console.log(
    "TOTAL MESSAGE SIZE:",
    JSON.stringify(opts.messages).length
  );

  return await withOllamaLock("chatStream", { model: opts.model, messageCount: opts.messages.length }, async () => {
    // Record HTTP request start for stream
    if (env.ENABLE_LATENCY_AUDIT) {
      const map = latencyMap.get(requestId);
      if (map) map.httpStart = Date.now() - startedAt;
    }
    console.log("MODEL:", opts.model);
    console.log("OPTIONS:", opts.options);

    logPromptAudit(opts.messages);
    logOllamaRequestShape("chatStream", {
      model: opts.model,
      stream: true,
      keepAlive: env.OLLAMA_KEEP_ALIVE,
      options: opts.options,
      messages: opts.messages,
    });
    const t0 = performance.now();
    console.time("OLLAMA_CHAT");
    const stream = (await withTimeout(
      client.chat({
        model: opts.model,
        messages: opts.messages,
        options: opts.options,
        keep_alive: env.OLLAMA_KEEP_ALIVE,
        stream: true,
      } as any),
      env.OLLAMA_TIMEOUT_MS,
      `Chat stream connection with ${opts.model}`
    )) as AsyncIterable<ChatResponse>;
    console.timeEnd("OLLAMA_CHAT");
    console.log("[STREAM_OBJECT_MS]", Math.round(performance.now() - t0));
    log.info("Stream started", {
      model: opts.model,
      stream: true,
      messageCount: opts.messages.length,
    });

    let full = "";
    let firstTokenRecorded = false;
    try {
      for await (const chunk of stream as AsyncIterable<ChatResponse>) {
        const token = chunk.message?.content ?? "";
        full += token;
        // Record first token time
        if (!firstTokenRecorded && token.length > 0) {
          firstTokenRecorded = true;
          console.log("[FIRST_TOKEN_MS]", Math.round(performance.now() - t0));
          if (env.ENABLE_LATENCY_AUDIT) {
            const map = latencyMap.get(requestId);
            if (map) map.firstToken = Date.now() - startedAt;
          }
        }
        if ((chunk as ChatResponse & { done?: boolean }).done) {
          logOllamaFinalStats(chunk);
        }
        try {
          onToken(token);
        } catch (callbackError) {
          log.warn("Token callback failed", {
            model: opts.model,
            error: callbackError instanceof Error ? callbackError.message : String(callbackError),
          });
        }
      }
    } catch (error) {
      // ─── Rule 8: Runner crash detection ──────────────────────────────────────
      if (isRunnerCrashError(error)) {
        await captureRunnerCrashDiagnostics({
          payloadChars: JSON.stringify(opts.messages).length,
          messageCount: opts.messages.length,
          model: opts.model,
          options: opts.options as Record<string, unknown>,
        });
      }
      throw normalizeOllamaError(error, {
        operation: "chatStream",
        model: opts.model,
        stream: true,
      });
    } finally {
      log.info("Stream ended", {
        model: opts.model,
        stream: true,
        outputChars: full.length,
      });
      if (env.ENABLE_LATENCY_AUDIT) {
        const map = latencyMap.get(requestId);
        if (map) map.streamComplete = Date.now() - startedAt;
        latencyTracker.report(requestId, latencyMap.get(requestId) ?? {});
        latencyMap.delete(requestId);
      }
    }

    return full.trim();
  });
}


// -------------------------------------------------------------------------------
// Generate / Embeddings
// -------------------------------------------------------------------------------

export async function generate(
  model: string,
  prompt: string,
  options?: Partial<GenerationOptions>
): Promise<string> {
  cancelOllamaWarmup("generate request started");
  await ensureModel(model);

  log.llm("Prompt received", { operation: "generate", model, promptLen: prompt.length });

  return await withOllamaLock("generate", { model, promptLen: prompt.length }, async () => {
    const response = await withRetry(
      async () => {
        log.info("Generate inference started", {
          model,
          promptLen: prompt.length,
          stream: false,
        });

        // Record HTTP request start for generation
        if (env.ENABLE_LATENCY_AUDIT) {
          const map = latencyMap.get(requestId);
          if (map) map.httpStart = Date.now() - startedAt;
        }

        logOllamaRequestShape("generate", {
          model,
          stream: false,
          options,
          prompt,
        });
        const result = await withTimeout(
          client.generate({
            model,
            prompt,
            options,
            stream: false,
          } as any),
          env.OLLAMA_TIMEOUT_MS,
          `Generate with ${model}`
        );
        return result as unknown as ChatResponse;
      },
      2,
      1000
    );

    const text = (response as unknown as { response: string }).response?.trim() ?? "";
    log.info("Generate inference ended", {
      model,
      responseChars: text.length,
      stream: false,
    });
    return text;
  });
}

export async function embed(texts: string | string[], model?: string): Promise<number[][]> {
  const input = Array.isArray(texts) ? texts : [texts];
  const embedModel = model ?? env.OLLAMA_EMBED_MODEL;
  await ensureModel(embedModel);

  log.llm("Prompt received", {
    operation: "embed",
    model: embedModel,
    itemCount: input.length,
  });

  return await withOllamaLock("embed", { model: embedModel, itemCount: input.length }, async () => {
    const response = await withRetry(
      async () => {
        log.info("Embedding started", {
          model: embedModel,
          itemCount: input.length,
          stream: false,
        });

        // Record HTTP request start for embed
        if (env.ENABLE_LATENCY_AUDIT) {
          const map = latencyMap.get(requestId);
          if (map) map.httpStart = Date.now() - startedAt;
        }

        const result = await client.embed({
          model: embedModel,
          input,
        } as any);
        return result;
      },
      2,
      1000
    );

    const embeddings = (response as { embeddings: number[][] }).embeddings;
    log.info("Embedding ended", {
      model: embedModel,
      itemCount: input.length,
      stream: false,
    });
    return embeddings;
  });
}

export async function embedSingle(text: string, model?: string): Promise<number[]> {
  const results = await embed(text, model);
  return results[0]!;
}

export async function pullModel(
  modelName: string,
  onProgress?: (part: { status?: string; completed?: number; total?: number }) => void
): Promise<void> {
  await withOllamaLock("pull", { modelName }, async () => {
    log.info("Model pull started", { modelName });
    const stream = await client.pull({ model: modelName, stream: true });
    for await (const part of stream as AsyncIterable<{ status?: string; completed?: number; total?: number }>) {
      if (onProgress) onProgress(part);
    }
    log.info("Model pull ended", { modelName });
  });
}

export { client as ollamaClient };
