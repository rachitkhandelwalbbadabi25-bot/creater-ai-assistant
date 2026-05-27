// -------------------------------------------------------------------------------
// src/llm/ollama.ts - Ollama client wrapper with lifecycle logging and mutex
// -------------------------------------------------------------------------------

import { Ollama } from "ollama";
import type { ChatResponse } from "ollama";
import { env } from "@config/index.js";
import type { GenerationOptions } from "@config/models.js";
import { createLogger } from "@utils/logger.js";
import { LLMError, safeAsync, type Result, withRetry } from "@utils/errorHandler.js";
import { withTimeout } from "@utils/helpers.js";

const log = createLogger("llm/ollama");

type OllamaRuntimeSingleton = {
  client: Ollama;
};

const globalRuntime = globalThis as typeof globalThis & {
  __createrOllamaRuntime?: OllamaRuntimeSingleton;
};

function createOllamaRuntime(): OllamaRuntimeSingleton {
  const client = new Ollama({ host: env.OLLAMA_BASE_URL });
  log.info("Ollama client initialized", {
    host: env.OLLAMA_BASE_URL,
    timeoutMs: env.OLLAMA_TIMEOUT_MS,
  });
  return { client };
}

const runtime = globalRuntime.__createrOllamaRuntime ?? createOllamaRuntime();

if (globalRuntime.__createrOllamaRuntime) {
  console.log("SINGLETON RUNTIME REUSED", {
    runtime: "ollama",
    host: env.OLLAMA_BASE_URL,
  });
} else {
  globalRuntime.__createrOllamaRuntime = runtime;
}

const { client } = runtime;

let queueTail: Promise<void> = Promise.resolve();
let activeOperations = 0;
let operationSeq = 0;

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

async function withOllamaLock<T>(
  operation: string,
  context: Record<string, unknown>,
  task: () => Promise<T>
): Promise<T> {
  const requestId = `${operation}-${++operationSeq}`;
  const queuedAt = Date.now();

  log.info("Ollama operation queued", {
    requestId,
    operation,
    activeOperations,
    ...context,
  });

  let release!: () => void;
  const waitForTurn = queueTail;
  queueTail = new Promise<void>((resolve) => {
    release = resolve;
  });

  await waitForTurn;

  activeOperations++;
  const startedAt = Date.now();
  log.info("Ollama operation started", {
    requestId,
    operation,
    waitMs: startedAt - queuedAt,
    activeOperations,
    ...context,
  });

  try {
    const result = await task();
    log.info("Ollama operation ended", {
      requestId,
      operation,
      durationMs: Date.now() - startedAt,
      activeOperations,
      ...context,
    });
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
      const modelNames = await listOllamaModels();
      log.info("Ollama startup check complete", {
        modelCount: modelNames.length,
        models: modelNames,
      });
      return modelNames;
    });
  });
}

export async function ensureModel(modelName: string): Promise<void> {
  await withOllamaLock("ensureModel", { modelName }, async () => {
    const healthModels = await listOllamaModels();
    const loaded = healthModels.some((m) => m.startsWith(modelName.split(":")[0]!));
    if (!loaded) {
      log.info("Model pull starting", { modelName });
      await client.pull({ model: modelName, stream: false });
      log.info("Model pull completed", { modelName });
    }
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

        const result = await withTimeout(
          client.chat({
            model: opts.model,
            messages: opts.messages,
            options: opts.options,
            format: opts.format,
            stream: false,
          } as any),
          env.OLLAMA_TIMEOUT_MS,
          `Chat with ${opts.model}`
        );
        return result as unknown as ChatResponse;
      },
      2,
      1000
    );

    const content = response.message?.content ?? "";
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
  log.llm("Prompt received", {
    operation: "chatStream",
    model: opts.model,
    messageCount: opts.messages.length,
    lastMsg: opts.messages[opts.messages.length - 1]?.content.slice(0, 100),
    stream: true,
  });

  return await withOllamaLock("chatStream", { model: opts.model, messageCount: opts.messages.length }, async () => {
    const streamStartedAt = Date.now();
    const stream = (await withTimeout(
      client.chat({
        model: opts.model,
        messages: opts.messages,
        options: opts.options,
        stream: true,
      } as any),
      env.OLLAMA_TIMEOUT_MS,
      `Chat stream connection with ${opts.model}`
    )) as AsyncIterable<ChatResponse>;

    log.info("Stream started", {
      model: opts.model,
      stream: true,
      messageCount: opts.messages.length,
    });

    let full = "";
    let finalChunkSeen = false;
    let finalTokenAt = 0;
    try {
      for await (const chunk of stream as AsyncIterable<ChatResponse>) {
        const token = chunk.message?.content ?? "";
        if (token) {
          full += token;
          finalTokenAt = Date.now();
          try {
            onToken(token);
          } catch (callbackError) {
            log.warn("Token callback failed", {
              model: opts.model,
              error: callbackError instanceof Error ? callbackError.message : String(callbackError),
            });
          }
        }

        if (chunk.done) {
          finalChunkSeen = true;
          console.log("STREAM FINAL TOKEN", {
            model: opts.model,
            outputChars: full.length,
          });
          console.log("STREAM CLOSE INITIATED", {
            model: opts.model,
            closeDelayMs: finalTokenAt ? Date.now() - finalTokenAt : 0,
          });
          break;
        }
      }
    } catch (error) {
      throw normalizeOllamaError(error, {
        operation: "chatStream",
        model: opts.model,
        stream: true,
      });
    } finally {
      console.log("STREAM CLOSED SUCCESSFULLY", {
        model: opts.model,
        finalChunkSeen,
        totalDurationMs: Date.now() - streamStartedAt,
      });
      log.info("Stream ended", {
        model: opts.model,
        stream: true,
        outputChars: full.length,
        durationMs: Date.now() - streamStartedAt,
      });
    }

    const response = full.trim();
    console.log("RESPONSE RESOLVED", {
      model: opts.model,
      responseChars: response.length,
      totalLifecycleMs: Date.now() - streamStartedAt,
    });
    return response;
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
  log.llm("Prompt received", { operation: "generate", model, promptLen: prompt.length });

  return await withOllamaLock("generate", { model, promptLen: prompt.length }, async () => {
    const response = await withRetry(
      async () => {
        log.info("Generate inference started", {
          model,
          promptLen: prompt.length,
          stream: false,
        });

        return await withTimeout(
          client.generate({
            model,
            prompt,
            options,
            stream: false,
          } as any),
          env.OLLAMA_TIMEOUT_MS,
          `Generate with ${model}`
        );
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
        return await client.embed({
          model: embedModel,
          input,
        } as any);
      },
      2,
      500
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
