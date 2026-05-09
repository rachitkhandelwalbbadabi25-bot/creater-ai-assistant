// ════════════════════════════════════════════════════════════════════════════════
// src/llm/ollama.ts — Ollama client wrapper with streaming, retries, and health check
// ════════════════════════════════════════════════════════════════════════════════

import { Ollama } from "ollama";
import type { ChatRequest, ChatResponse, GenerateRequest, EmbedRequest } from "ollama";
import { env } from "@config/index.js";
import type { GenerationOptions } from "@config/models.js";
import { createLogger } from "@utils/logger.js";
import { LLMError, withRetry, safeAsync, type Result } from "@utils/errorHandler.js";
import { withTimeout } from "@utils/helpers.js";

const log = createLogger("llm/ollama");

// ─── Singleton Ollama Client ──────────────────────────────────────────────────────
const client = new Ollama({ host: env.OLLAMA_BASE_URL });

// ─── Health Check ─────────────────────────────────────────────────────────────────
/**
 * Checks if Ollama is running and reachable.
 * Returns list of loaded models on success.
 */
export async function checkOllamaHealth(): Promise<Result<string[]>> {
  return safeAsync(async () => {
    const response = await withTimeout(client.list(), 5000, "Ollama health check");
    const modelNames = (response as any).models.map((m: any) => m.name);
    log.info(`Ollama connected — ${modelNames.length} models available`, {
      models: modelNames,
    });
    return modelNames;
  });
}

/**
 * Ensures a specific model is available. Pulls it if missing.
 */
export async function ensureModel(modelName: string): Promise<void> {
  const health = await checkOllamaHealth();
  if (!health.ok) {
    throw new LLMError(`Ollama is not reachable: ${health.error.message}`);
  }

  const loaded = health.value.some((m) => m.startsWith(modelName.split(":")[0]!));
  if (!loaded) {
    log.info(`Model "${modelName}" not found — pulling...`);
    try {
      await client.pull({ model: modelName, stream: false });
      log.info(`Model "${modelName}" pulled successfully`);
    } catch (e) {
      throw new LLMError(`Failed to pull model "${modelName}"`, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

// ─── Chat Completion ──────────────────────────────────────────────────────────────

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

/**
 * Send a chat completion request to Ollama.
 * Retries up to 2 times on transient failures.
 */
export async function chat(opts: ChatOptions): Promise<string> {
  log.llm(`Chat request to ${opts.model}`, {
    messageCount: opts.messages.length,
    lastMsg: opts.messages[opts.messages.length - 1]?.content.slice(0, 100),
  });

  const response = await withRetry(
    async () => {
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

  log.llm(`Chat response from ${opts.model}`, {
    tokens: response.eval_count,
    duration: response.total_duration
      ? `${(Number(response.total_duration) / 1e9).toFixed(2)}s`
      : "unknown",
  });

  return content.trim();
}

// ─── Streaming Chat ───────────────────────────────────────────────────────────────

/**
 * Stream a chat completion token-by-token.
 * Calls `onToken` for each chunk and returns the full accumulated response.
 */
export async function chatStream(
  opts: Omit<ChatOptions, "stream">,
  onToken: (token: string) => void
): Promise<string> {
  log.llm(`Streaming chat to ${opts.model}`);

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

  let full = "";
  for await (const chunk of stream as AsyncIterable<ChatResponse>) {
    const token = chunk.message?.content ?? "";
    full += token;
    onToken(token);
  }

  return full.trim();
}

// ─── Simple Generate (single prompt, no chat history) ─────────────────────────────

export async function generate(
  model: string,
  prompt: string,
  options?: Partial<GenerationOptions>
): Promise<string> {
  log.llm(`Generate request to ${model}`, { promptLen: prompt.length });

  const response = await withRetry(
    async () => {
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

  return (response as unknown as { response: string }).response?.trim() ?? "";
}

// ─── Embeddings ───────────────────────────────────────────────────────────────────

/**
 * Generate embeddings for one or more text inputs.
 * Uses the configured embedding model (nomic-embed-text by default).
 */
export async function embed(
  texts: string | string[],
  model?: string
): Promise<number[][]> {
  const input = Array.isArray(texts) ? texts : [texts];
  const embedModel = model ?? env.OLLAMA_EMBED_MODEL;

  log.llm(`Embedding ${input.length} text(s) with ${embedModel}`);

  const response = await withRetry(
    async () => {
      return await client.embed({
        model: embedModel,
        input,
      } as any);
    },
    2,
    500
  );

  return (response as { embeddings: number[][] }).embeddings;
}

/**
 * Generate a single embedding vector for one text.
 */
export async function embedSingle(text: string, model?: string): Promise<number[]> {
  const results = await embed(text, model);
  return results[0]!;
}

// ─── Export client for advanced usage ─────────────────────────────────────────────
export { client as ollamaClient };
