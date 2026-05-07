// ════════════════════════════════════════════════════════════════════════════════
// src/config/models.ts — LLM model registry, routing rules, and generation params
// ════════════════════════════════════════════════════════════════════════════════

import { env } from "./index.js";

// ─── Model Registry ───────────────────────────────────────────────────────────────
export const Models = {
  /** High-capability model for deep reasoning, planning, complex tasks */
  PRIMARY: env.OLLAMA_PRIMARY_MODEL,
  /** Lightweight model for routing, emotion detection, quick classification */
  FAST: env.OLLAMA_FAST_MODEL,
  /** Code-specialized model for all coding tasks */
  CODER: env.OLLAMA_CODER_MODEL,
  /** Embedding model for semantic memory and RAG */
  EMBED: env.OLLAMA_EMBED_MODEL,
} as const;

export type ModelKey = keyof typeof Models;
export type ModelName = (typeof Models)[ModelKey];

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
 * Returns the best model for a given task type.
 * Falls back to PRIMARY if task type is not mapped.
 */
export function getModelForTask(taskType: string): ModelName {
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
