// ════════════════════════════════════════════════════════════════════════════════
// src/llm/client.ts — Unified LLM client for Ollama + Cloud providers
//
// Routing Priority:
//   1. If model is an Ollama model → use Ollama
//   2. If model is a cloud model → call cloud API with fallback to local
//   3. On cloud failure → automatically fallback to OLLAMA_PRIMARY_MODEL
// ════════════════════════════════════════════════════════════════════════════════

import { chat as ollamaChat, chatStream as ollamaChatStream } from "./ollama.js";
import { env } from "@config/index.js";
import { AvailableModels, ProviderAvailability, getProviderForModel, type ModelProvider } from "@config/models.js";
import { createLogger } from "@utils/logger.js";
import type { ChatMessage } from "./ollama.js";

const log = createLogger("llm/client");

export type { ChatMessage };

export interface UnifiedChatOptions {
  model: string;
  messages: ChatMessage[];
  options?: { temperature?: number; top_p?: number; num_predict?: number };
  format?: "json";
}

// ─── Provider Detection ─────────────────────────────────────────────────────────
function getProvider(modelId: string): ModelProvider {
  return getProviderForModel(modelId);
}

// ─── OpenAI-Compatible Providers (OpenAI, Grok, DeepSeek) ───────────────────────
async function callOpenAICompatible(
  opts: UnifiedChatOptions,
  baseUrl: string,
  apiKey: string,
  providerName: string
): Promise<string> {
  const body = {
    model: opts.model,
    messages: opts.messages,
    max_tokens: opts.options?.num_predict ?? 4096,
    temperature: opts.options?.temperature ?? 0.7,
  };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${providerName} API error ${res.status}: ${err}`);
  }

  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content?.trim() ?? "";
}

// ─── Anthropic (Claude) ─────────────────────────────────────────────────────────
async function callAnthropic(opts: UnifiedChatOptions): Promise<string> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const system = opts.messages.find(m => m.role === "system")?.content ?? "";
  const userMessages = opts.messages.filter(m => m.role !== "system");

  const body = {
    model: opts.model,
    max_tokens: opts.options?.num_predict ?? 4096,
    temperature: opts.options?.temperature ?? 0.7,
    ...(system ? { system } : {}),
    messages: userMessages,
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }

  const data = await res.json() as { content: Array<{ type: string; text: string }> };
  return data.content.map(c => c.text).join("").trim();
}

// ─── Gemini ──────────────────────────────────────────────────────────────────────
async function callGemini(opts: UnifiedChatOptions): Promise<string> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  // Convert messages to Gemini format
  const contents = opts.messages
    .filter(m => m.role !== "system")
    .map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const systemText = opts.messages.find(m => m.role === "system")?.content;

  const body: any = {
    contents,
    generationConfig: {
      maxOutputTokens: opts.options?.num_predict ?? 4096,
      temperature: opts.options?.temperature ?? 0.7,
    },
  };
  if (systemText) {
    body.systemInstruction = { parts: [{ text: systemText }] };
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }

  const data = await res.json() as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
  };
  return data.candidates[0]?.content?.parts?.map(p => p.text).join("").trim() ?? "";
}

// ─── Fallback to Local ───────────────────────────────────────────────────────────
async function fallbackToLocal(opts: UnifiedChatOptions): Promise<string> {
  log.warn(`Falling back to local model: ${env.OLLAMA_PRIMARY_MODEL}`);
  return ollamaChat({ ...opts, model: env.OLLAMA_PRIMARY_MODEL });
}

// ─── Unified Chat ────────────────────────────────────────────────────────────────
/**
 * Route a chat request to the correct provider.
 * Never logs API keys. Falls back to local on any cloud failure.
 */
export async function chat(opts: UnifiedChatOptions): Promise<string> {
  const provider = getProvider(opts.model);
  log.info(`Chat → provider: ${provider}, model: ${opts.model}`);
  log.info("Prompt received", {
    provider,
    model: opts.model,
    messageCount: opts.messages.length,
    format: opts.format ?? "text",
    lastMsg: opts.messages[opts.messages.length - 1]?.content.slice(0, 120),
  });

  try {
    switch (provider) {
      case "anthropic":
        if (!ProviderAvailability.anthropic) throw new Error("Anthropic key not configured");
        return await callAnthropic(opts);

      case "openai":
        if (!ProviderAvailability.openai) throw new Error("OpenAI key not configured");
        return await callOpenAICompatible(opts, "https://api.openai.com/v1", env.OPENAI_API_KEY, "OpenAI");

      case "grok":
        if (!ProviderAvailability.grok) throw new Error("Grok key not configured");
        return await callOpenAICompatible(opts, "https://api.x.ai/v1", env.GROK_API_KEY, "Grok");

      case "deepseek":
        if (!ProviderAvailability.deepseek) throw new Error("DeepSeek key not configured");
        return await callOpenAICompatible(opts, "https://api.deepseek.com/v1", env.DEEPSEEK_API_KEY, "DeepSeek");

      case "gemini":
        if (!ProviderAvailability.gemini) throw new Error("Gemini key not configured");
        return await callGemini(opts);

      default:
        // Ollama
        return await ollamaChat(opts as any);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Cloud provider (${provider}) failed: ${message}. Falling back to local.`);
    return fallbackToLocal(opts);
  }
}

/**
 * Streaming chat — streams from Ollama, or falls back gracefully for cloud models.
 * Cloud models produce a single response (streamed as one chunk via onToken).
 */
export async function chatStream(
  opts: Omit<UnifiedChatOptions, "format">,
  onToken: (token: string) => void
): Promise<string> {
  const provider = getProvider(opts.model);
  const streamStartedAt = Date.now();
  log.info("Prompt received", {
    provider,
    model: opts.model,
    messageCount: opts.messages.length,
    stream: true,
    lastMsg: opts.messages[opts.messages.length - 1]?.content.slice(0, 120),
  });

  if (provider === "ollama") {
    try {
      const response = await ollamaChatStream(opts as any, onToken);
      console.log("RESPONSE RESOLVED", {
        provider,
        model: opts.model,
        totalLifecycleMs: Date.now() - streamStartedAt,
      });
      return response;
    } catch (err) {
      log.error(`Local Ollama stream failed for model ${opts.model}: ${err}. Falling back to default model.`);
      const fallbackModel = env.DEFAULT_MODEL || "qwen2.5:3b";
      if (opts.model === fallbackModel) {
        throw err;
      }
      const response = await ollamaChatStream({ ...opts, model: fallbackModel } as any, onToken);
      console.log("RESPONSE RESOLVED", {
        provider,
        model: fallbackModel,
        totalLifecycleMs: Date.now() - streamStartedAt,
      });
      return response;
    }
  }

  // Cloud models: call non-streaming, emit full response as a single token chunk
  try {
    const response = await chat(opts);
    onToken(response);
    console.log("STREAM FINAL TOKEN", { provider, model: opts.model, outputChars: response.length });
    console.log("STREAM CLOSE INITIATED", { provider, model: opts.model, closeDelayMs: 0 });
    console.log("STREAM CLOSED SUCCESSFULLY", { provider, model: opts.model, totalDurationMs: Date.now() - streamStartedAt });
    log.info("Stream ended", {
      provider,
      model: opts.model,
      stream: false,
      outputChars: response.length,
      durationMs: Date.now() - streamStartedAt,
    });
    console.log("RESPONSE RESOLVED", {
      provider,
      model: opts.model,
      totalLifecycleMs: Date.now() - streamStartedAt,
    });
    return response;
  } catch (err) {
    const local = await fallbackToLocal(opts);
    onToken(local);
    console.log("STREAM FINAL TOKEN", { provider, model: opts.model, outputChars: local.length });
    console.log("STREAM CLOSE INITIATED", { provider, model: opts.model, closeDelayMs: 0 });
    console.log("STREAM CLOSED SUCCESSFULLY", { provider, model: opts.model, totalDurationMs: Date.now() - streamStartedAt });
    log.info("Stream ended", {
      provider,
      model: opts.model,
      stream: false,
      outputChars: local.length,
      durationMs: Date.now() - streamStartedAt,
    });
    console.log("RESPONSE RESOLVED", {
      provider,
      model: opts.model,
      totalLifecycleMs: Date.now() - streamStartedAt,
    });
    return local;
  }
}
