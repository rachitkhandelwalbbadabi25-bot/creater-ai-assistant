import type { ChatMessage } from "./ollama.js";
import { env } from "@config/index.js";
import { ProviderAvailability, getProviderForModel, type ModelProvider } from "@config/models.js";
import { createLogger } from "@utils/logger.js";
import { IS_RUNTIME_DEBUG } from "@utils/perf.js";

const log = createLogger("llm/client");

export type { ChatMessage };

export interface UnifiedChatOptions {
  model: string;
  messages: ChatMessage[];
  options?: { temperature?: number; top_p?: number; num_predict?: number };
  format?: "json";
}

function getProvider(modelId: string): ModelProvider {
  return getProviderForModel(modelId);
}

async function callOpenAICompatible(
  opts: UnifiedChatOptions,
  baseUrl: string,
  apiKey: string,
  providerName: string,
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
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${providerName} API error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content?.trim() ?? "";
}

async function callAnthropic(opts: UnifiedChatOptions): Promise<string> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const system = opts.messages.find((m) => m.role === "system")?.content ?? "";
  const userMessages = opts.messages.filter((m) => m.role !== "system");

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

  const data = (await res.json()) as { content: Array<{ type: string; text: string }> };
  return data.content.map((c) => c.text).join("").trim();
}

async function callGemini(opts: UnifiedChatOptions): Promise<string> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const contents = opts.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const systemText = opts.messages.find((m) => m.role === "system")?.content;

  const body: Record<string, unknown> = {
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
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
  };
  return data.candidates[0]?.content?.parts?.map((p) => p.text).join("").trim() ?? "";
}

async function fallbackToLocal(opts: UnifiedChatOptions): Promise<string> {
  log.warn(`Falling back to local model: ${env.OLLAMA_PRIMARY_MODEL}`);
  const { chat: ollamaChat } = await import("./ollama.js");
  return ollamaChat({ ...opts, model: env.OLLAMA_PRIMARY_MODEL });
}

export async function chat(opts: UnifiedChatOptions): Promise<string> {
  const provider = getProvider(opts.model);
  if (IS_RUNTIME_DEBUG) {
    log.info(`Chat -> provider: ${provider}, model: ${opts.model}`);
    log.info("Prompt received", {
      provider,
      model: opts.model,
      messageCount: opts.messages.length,
      format: opts.format ?? "text",
      lastMsg: opts.messages[opts.messages.length - 1]?.content.slice(0, 120),
    });
  }

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
      default: {
        const { chat: ollamaChat } = await import("./ollama.js");
        return await ollamaChat(opts as never);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Cloud provider (${provider}) failed: ${message}. Falling back to local.`);
    return fallbackToLocal(opts);
  }
}

export async function chatStream(
  opts: Omit<UnifiedChatOptions, "format">,
  onToken: (token: string) => void,
): Promise<string> {
  const provider = getProvider(opts.model);
  if (IS_RUNTIME_DEBUG) {
    log.info("Prompt received", {
      provider,
      model: opts.model,
      messageCount: opts.messages.length,
      stream: true,
      lastMsg: opts.messages[opts.messages.length - 1]?.content.slice(0, 120),
    });
  }

  if (provider === "ollama") {
    try {
      const { chatStream: ollamaChatStream } = await import("./ollama.js");
      return await ollamaChatStream(opts as never, onToken);
    } catch (err) {
      log.error(`Local Ollama stream failed for model ${opts.model}: ${err}. Falling back to default model.`);
      const fallbackModel = env.DEFAULT_MODEL || "qwen2.5:3b";
      if (opts.model === fallbackModel) {
        throw err;
      }
      const { chatStream: ollamaChatStream } = await import("./ollama.js");
      return await ollamaChatStream({ ...opts, model: fallbackModel } as never, onToken);
    }
  }

  try {
    const response = await chat(opts);
    onToken(response);
    if (IS_RUNTIME_DEBUG) {
      log.info("Stream ended", {
        provider,
        model: opts.model,
        stream: false,
        outputChars: response.length,
      });
    }
    return response;
  } catch {
    const local = await fallbackToLocal(opts);
    onToken(local);
    if (IS_RUNTIME_DEBUG) {
      log.info("Stream ended", {
        provider,
        model: opts.model,
        stream: false,
        outputChars: local.length,
      });
    }
    return local;
  }
}
