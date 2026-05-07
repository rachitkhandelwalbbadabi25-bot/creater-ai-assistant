// ════════════════════════════════════════════════════════════════════════════════
// src/llm/router.ts — Smart model selection based on intent and task type
// ════════════════════════════════════════════════════════════════════════════════

import { chat, type ChatMessage } from "./ollama.js";
import { INTENT_CLASSIFICATION_PROMPT } from "./prompts.js";
import { Models, getModelForTask, getPresetForTask, GenerationPresets } from "@config/models.js";
import { createLogger } from "@utils/logger.js";
import { safeAsync, type Result } from "@utils/errorHandler.js";

const log = createLogger("llm/router");

// ─── Intent Classification Result ─────────────────────────────────────────────────
export interface IntentResult {
  intent: string;
  confidence: number;
  entities: Record<string, string>;
}

// ─── Route Result ─────────────────────────────────────────────────────────────────
export interface RouteDecision {
  intent: IntentResult;
  model: string;
  preset: keyof typeof GenerationPresets;
  agent: string; // which agent should handle this
}

// ─── Intent → Agent Mapping ───────────────────────────────────────────────────────
const INTENT_TO_AGENT: Record<string, string> = {
  chitchat: "emotionAgent",
  task_management: "taskAgent",
  project_query: "projectAgent",
  code_request: "projectAgent",
  system_control: "laptopAgent",
  browser_action: "laptopAgent",
  file_operation: "laptopAgent",
  memory_query: "taskAgent",
  emotion_support: "emotionAgent",
  knowledge_qa: "taskAgent",
  scheduling: "taskAgent",
  meta: "taskAgent",
};

// ─── Classify Intent ──────────────────────────────────────────────────────────────
/**
 * Uses the FAST model to quickly classify user intent.
 * Returns structured intent with confidence score.
 */
export async function classifyIntent(
  userMessage: string
): Promise<Result<IntentResult>> {
  return safeAsync(async () => {
    const messages: ChatMessage[] = [
      { role: "system", content: INTENT_CLASSIFICATION_PROMPT },
      { role: "user", content: userMessage },
    ];

    const response = await chat({
      model: Models.FAST,
      messages,
      options: GenerationPresets.classification,
      format: "json",
    });

    // Parse JSON response
    const parsed = JSON.parse(response) as IntentResult;

    log.info(`Intent: ${parsed.intent} (${(parsed.confidence * 100).toFixed(0)}%)`, {
      message: userMessage.slice(0, 80),
    });

    return parsed;
  });
}

// ─── Route Request ────────────────────────────────────────────────────────────────
/**
 * Full routing pipeline:
 * 1. Classify the user's intent (fast model)
 * 2. Select the appropriate model + generation preset
 * 3. Determine which agent should handle the request
 */
export async function routeRequest(
  userMessage: string
): Promise<Result<RouteDecision>> {
  return safeAsync(async () => {
    // Step 1: Classify intent
    const intentResult = await classifyIntent(userMessage);
    if (!intentResult.ok) throw intentResult.error;

    const intent = intentResult.value;

    // Step 2: Select model and preset
    const model = getModelForTask(intent.intent);
    const preset = getPresetKeyForIntent(intent.intent);

    // Step 3: Select agent
    const agent = INTENT_TO_AGENT[intent.intent] ?? "taskAgent";

    const decision: RouteDecision = { intent, model, preset, agent };

    log.info(`Routed → agent: ${agent}, model: ${model}, preset: ${preset}`, {
      intent: intent.intent,
      confidence: intent.confidence,
    });

    return decision;
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────────

function getPresetKeyForIntent(intent: string): keyof typeof GenerationPresets {
  if (intent.includes("code") || intent.includes("git")) return "coding";
  if (
    intent === "chitchat" ||
    intent === "emotion_support"
  ) return "conversational";
  if (
    intent === "intent_classification" ||
    intent === "routing"
  ) return "classification";
  return "precise";
}

/**
 * Quick intent check — returns just the intent string without full routing.
 * Useful for lightweight checks (e.g., "is this a dangerous command?").
 */
export async function quickIntent(message: string): Promise<string> {
  const result = await classifyIntent(message);
  if (result.ok) return result.value.intent;
  return "unknown";
}
