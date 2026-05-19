// ════════════════════════════════════════════════════════════════════════════════
// src/config/models.ts — LLM model registry, routing rules, and generation params
// ════════════════════════════════════════════════════════════════════════════════

import { env } from "./index.js";

// ─── Model Providers ─────────────────────────────────────────────────────────────
export type ModelProvider = "ollama" | "anthropic" | "openai" | "grok" | "gemini" | "deepseek";

export interface ModelDefinition {
  id: string;
  provider: ModelProvider;
  type: "fast" | "reasoning" | "coder" | "embedding";
  contextWindow?: number;
}

// ─── Model Catalog ───────────────────────────────────────────────────────────────
export const AvailableModels: Record<string, ModelDefinition> = {
  // Local Models
  [env.OLLAMA_FAST_MODEL]: { id: env.OLLAMA_FAST_MODEL, provider: "ollama", type: "fast" },
  [env.OLLAMA_PRIMARY_MODEL]: { id: env.OLLAMA_PRIMARY_MODEL, provider: "ollama", type: "reasoning" },
  [env.OLLAMA_CODER_MODEL]: { id: env.OLLAMA_CODER_MODEL, provider: "ollama", type: "coder" },
  [env.OLLAMA_EMBED_MODEL]: { id: env.OLLAMA_EMBED_MODEL, provider: "ollama", type: "embedding" },
  "qwen2.5:7b": { id: "qwen2.5:7b", provider: "ollama", type: "coder" },
  
  // Cloud Models
  "claude-3-5-sonnet-20241022": { id: "claude-3-5-sonnet-20241022", provider: "anthropic", type: "reasoning", contextWindow: 200000 },
  "claude-3-haiku-20240307": { id: "claude-3-haiku-20240307", provider: "anthropic", type: "fast", contextWindow: 200000 },
  "gpt-4o": { id: "gpt-4o", provider: "openai", type: "reasoning", contextWindow: 128000 },
  "gpt-4o-mini": { id: "gpt-4o-mini", provider: "openai", type: "fast", contextWindow: 128000 },
  "grok-beta": { id: "grok-beta", provider: "grok", type: "reasoning", contextWindow: 128000 },
  "gemini-1.5-pro": { id: "gemini-1.5-pro", provider: "gemini", type: "reasoning", contextWindow: 2000000 },
  "gemini-1.5-flash": { id: "gemini-1.5-flash", provider: "gemini", type: "fast", contextWindow: 1000000 },
  "deepseek-chat": { id: "deepseek-chat", provider: "deepseek", type: "reasoning", contextWindow: 64000 },
  "deepseek-coder": { id: "deepseek-coder", provider: "deepseek", type: "coder", contextWindow: 64000 },
};

/**
 * Checks if a model ID corresponds to a local Ollama model.
 */
export function isLocalModel(modelId: string): boolean {
  const provider = getProviderForModel(modelId);
  return provider === "ollama";
}

/**
 * Resolves the provider for any given model ID.
 * Supports catalog lookups, standard prefixes, and falls back to configured provider or local.
 */
export function getProviderForModel(modelId: string): ModelProvider {
  // 1. Catalog lookup
  const def = AvailableModels[modelId];
  if (def) return def.provider;

  // 2. Prefix heuristics
  const lower = modelId.toLowerCase();
  if (lower.startsWith("claude-")) return "anthropic";
  if (lower.startsWith("gpt-") || lower.startsWith("o1-") || lower.startsWith("o3-")) return "openai";
  if (lower.startsWith("grok-")) return "grok";
  if (lower.startsWith("gemini-")) return "gemini";
  if (lower.startsWith("deepseek-")) return "deepseek";

  // 3. Current active provider (if explicit)
  const prov = env.LLM_PROVIDER;
  if (prov !== "local" && prov !== "cloud") {
    return prov as ModelProvider;
  }

  // 4. Default to local
  return "ollama";
}

// ─── Provider Availability ───────────────────────────────────────────────────────
export const ProviderAvailability = {
  get anthropic() { return !!env.ANTHROPIC_API_KEY; },
  get openai() { return !!env.OPENAI_API_KEY; },
  get grok() { return !!env.GROK_API_KEY; },
  get gemini() { return !!env.GEMINI_API_KEY; },
  get deepseek() { return !!env.DEEPSEEK_API_KEY; },
  get ollama() { return true; }, // Local is always available
};

// ─── Default Model Aliases ───────────────────────────────────────────────────────
export const Models = {
  /** High-capability model for deep reasoning, planning, complex tasks */
  get PRIMARY() {
    const prov = env.LLM_PROVIDER;
    if (prov === "anthropic" && ProviderAvailability.anthropic) return "claude-3-5-sonnet-20241022";
    if (prov === "openai" && ProviderAvailability.openai) return "gpt-4o";
    if (prov === "gemini" && ProviderAvailability.gemini) return "gemini-1.5-pro";
    if (prov === "grok" && ProviderAvailability.grok) return "grok-beta";
    if (prov === "deepseek" && ProviderAvailability.deepseek) return "deepseek-chat";

    if (prov === "cloud") {
      if (ProviderAvailability.anthropic) return "claude-3-5-sonnet-20241022";
      if (ProviderAvailability.openai) return "gpt-4o";
      if (ProviderAvailability.gemini) return "gemini-1.5-pro";
      if (ProviderAvailability.deepseek) return "deepseek-chat";
      if (ProviderAvailability.grok) return "grok-beta";
      return env.DEFAULT_CLOUD_MODEL;
    }
    return env.OLLAMA_PRIMARY_MODEL || "qwen2.5:3b";
  },
  /** Lightweight model for routing, emotion detection, quick classification */
  get FAST() {
    const prov = env.LLM_PROVIDER;
    if (prov === "openai" && ProviderAvailability.openai) return "gpt-4o-mini";
    if (prov === "anthropic" && ProviderAvailability.anthropic) return "claude-3-haiku-20240307";
    if (prov === "gemini" && ProviderAvailability.gemini) return "gemini-1.5-flash";
    if (prov === "deepseek" && ProviderAvailability.deepseek) return "deepseek-chat";

    if (prov === "cloud") {
      if (ProviderAvailability.openai) return "gpt-4o-mini";
      if (ProviderAvailability.anthropic) return "claude-3-haiku-20240307";
      if (ProviderAvailability.gemini) return "gemini-1.5-flash";
      if (ProviderAvailability.deepseek) return "deepseek-chat";
      return env.DEFAULT_CLOUD_MODEL;
    }
    return env.OLLAMA_FAST_MODEL || "qwen2.5:3b";
  },
  /** Code-specialized model for all coding tasks */
  get CODER() {
    const prov = env.LLM_PROVIDER;
    if (prov === "deepseek" && ProviderAvailability.deepseek) return "deepseek-chat";
    if (prov === "anthropic" && ProviderAvailability.anthropic) return "claude-3-5-sonnet-20241022";
    if (prov === "openai" && ProviderAvailability.openai) return "gpt-4o";
    if (prov === "gemini" && ProviderAvailability.gemini) return "gemini-1.5-pro";

    if (prov === "cloud") {
      if (ProviderAvailability.deepseek) return "deepseek-chat";
      if (ProviderAvailability.anthropic) return "claude-3-5-sonnet-20241022";
      if (ProviderAvailability.openai) return "gpt-4o";
      if (ProviderAvailability.gemini) return "gemini-1.5-pro";
      return env.DEFAULT_CLOUD_MODEL;
    }
    return "qwen2.5:7b";
  },
  /** Embedding model for semantic memory and RAG */
  get EMBED() {
    return env.OLLAMA_EMBED_MODEL;
  },
} as const;

export type ModelKey = keyof typeof Models;
export type ModelName = string;

// ─── Task Categories → Model Routing ─────────────────────────────────────────────
// Maps intent types to the appropriate model to use.
// Cost efficiency: use FAST for simple tasks, PRIMARY for reasoning.
export const ModelRoutes: Record<string, ModelName> = {
  // Classification / quick decisions → fast model
  intent_classification: Models.FAST,
  emotion_detection: Models.FAST,
  simple_qa: Models.FAST,
  chitchat: Models.FAST,
  routing: Models.FAST,

  // Reasoning / planning → primary model
  task_planning: Models.PRIMARY,
  project_analysis: Models.PRIMARY,
  deep_reasoning: Models.PRIMARY,
  memory_synthesis: Models.PRIMARY,
  skill_generation: Models.PRIMARY,
  morning_briefing: Models.PRIMARY,

  // Code tasks → coder model
  code_generation: Models.CODER,
  code_review: Models.CODER,
  code_debug: Models.CODER,
  code_explanation: Models.CODER,
  git_operations: Models.CODER,

  // Embeddings → embed model
  embedding: Models.EMBED,
};

// ─── Default Generation Parameters ───────────────────────────────────────────────
export interface GenerationOptions {
  temperature: number;
  top_p: number;
  top_k: number;
  num_predict: number;   // Max tokens to generate
  repeat_penalty: number;
  stop?: string[];
}

/**
 * Preset generation options tuned per use case.
 * Access via: GenerationPresets.balanced
 */
export const GenerationPresets = {
  /** Creative, conversational responses */
  conversational: {
    temperature: 0.8,
    top_p: 0.9,
    top_k: 40,
    num_predict: 1024,
    repeat_penalty: 1.1,
  } satisfies GenerationOptions,

  /** Factual, focused answers */
  precise: {
    temperature: 0.3,
    top_p: 0.85,
    top_k: 30,
    num_predict: 512,
    repeat_penalty: 1.05,
  } satisfies GenerationOptions,

  /** Very fast classification (yes/no, labels) */
  classification: {
    temperature: 0.1,
    top_p: 0.7,
    top_k: 10,
    num_predict: 64,
    repeat_penalty: 1.0,
  } satisfies GenerationOptions,

  /** Code generation — low temp for correctness */
  coding: {
    temperature: 0.2,
    top_p: 0.9,
    top_k: 40,
    num_predict: 2048,
    repeat_penalty: 1.05,
    stop: ["```\n\n", "Human:", "User:"],
  } satisfies GenerationOptions,

  /** Long-form reasoning and planning */
  reasoning: {
    temperature: 0.5,
    top_p: 0.92,
    top_k: 50,
    num_predict: 4096,
    repeat_penalty: 1.08,
  } satisfies GenerationOptions,
} as const;

export type PresetKey = keyof typeof GenerationPresets;

/**
 * Returns the best model ID for a given task type.
 * Falls back to PRIMARY if task type is not mapped.
 */
export function getModelForTask(taskType: string): string {
  return ModelRoutes[taskType] ?? Models.PRIMARY;
}

/**
 * Returns the best generation preset for a given task type.
 */
export function getPresetForTask(taskType: string): GenerationOptions {
  if (taskType.includes("code") || taskType.includes("git")) return GenerationPresets.coding;
  if (taskType.includes("classification") || taskType.includes("routing") || taskType.includes("emotion")) return GenerationPresets.classification;
  if (taskType.includes("reasoning") || taskType.includes("planning") || taskType.includes("synthesis")) return GenerationPresets.reasoning;
  if (taskType === "chitchat" || taskType === "morning_briefing" || taskType === "night_check") return GenerationPresets.conversational;
  return GenerationPresets.precise;
}
