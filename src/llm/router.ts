// ════════════════════════════════════════════════════════════════════════════════
// src/llm/router.ts — Smart model selection based on intent and task type
// ════════════════════════════════════════════════════════════════════════════════

import { chat, type ChatMessage } from "./client.js";
import { INTENT_CLASSIFICATION_PROMPT } from "./prompts.js";
import { Models, getModelForTask, getPresetForTask, GenerationPresets } from "@config/models.js";
import { env } from "@config/index.js";
import { setSetting } from "@config/settings.js";
import { createLogger } from "@utils/logger.js";
import { safeAsync, type Result } from "@utils/errorHandler.js";

import { IntentEnum } from "../runtime/semantic/semanticTypes.js";

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

// ─── Manual Override State ────────────────────────────────────────────────────────
// ─── Manual Override State (Persisted in SQLite) ──────────────────────────────────
export function setModelOverride(modelName: string | null) {
  setSetting("DEFAULT_MODEL", modelName || "");
  if (modelName) {
    log.info(`Manual model override set and persisted to: ${modelName}`);
  } else {
    log.info(`Manual model override cleared and persisted. Using auto-routing.`);
  }
}

export function getModelOverride(): string | null {
  return env.DEFAULT_MODEL || null;
}

// ─── Intent → Agent Mapping ───────────────────────────────────────────────────────
const INTENT_TO_AGENT: Record<string, string> = {
  chitchat: "taskAgent",
  [IntentEnum.CONVERSATION]: "taskAgent",
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

// ─── Quick Keyword Route ─────────────────────────────────────────────────────────
// ─── Quick Keyword Route ─────────────────────────────────────────────────────────
function quickKeywordRoute(message: string): IntentResult | null {
  const msg = message.toLowerCase();
  if (msg.match(/\b(hi|hello|hey|how are you|good morning|good evening)\b/))
    return { intent: IntentEnum.CONVERSATION, confidence: 0.95, entities: {} };
  // Emotional support / empathy
  if (msg.match(/\b(sad|happy|angry|upset|stress|stressed|anxious|anxiety|depressed|depression|tired|lonely|alone|hopeless|overwhelmed|burnout|excited|grateful|mood|feel|feeling|nobody understands|emotional patterns?|emotion profile|emotion history)\b/))
    return { intent: "emotion_support", confidence: 0.9, entities: {} };
  // Technical discussion / code related
  if (msg.match(/\b(code|bug|error|function|class|import|typescript|javascript)\b/))
    return { intent: "technical_discussion", confidence: 0.9, entities: {} };
  // Planning / scheduling
  if (msg.match(/\b(plan|schedule|timeline|deadline|milestone)\b/))
    return { intent: "planning", confidence: 0.9, entities: {} };
  // Brainstorming
  if (msg.match(/\b(idea|brainstorm|concept|prototype)\b/))
    return { intent: "brainstorming", confidence: 0.9, entities: {} };
  // Continuation / follow‑up
  if (msg.match(/\b(continue|go on|next|more|add)\b/))
    return { intent: "continuation", confidence: 0.85, entities: {} };
  // Task / reminder shortcuts
  if (msg.match(/\b(task|todo|remind|deadline|schedule)\b/))
    return { intent: "task_management", confidence: 0.9, entities: {} };
  // Fallback none
  return null;
}

// ─── Classify Intent ──────────────────────────────────────────────────────────────
/**
 * Uses the FAST model to quickly classify user intent.
 * Returns structured intent with confidence score.
 */
export async function classifyIntent(
  userMessage: string
): Promise<Result<IntentResult>> {
  const start = Date.now();
  // First try deterministic detection
  const deterministic = quickKeywordRoute(userMessage);
  if (deterministic) {
    const duration = Date.now() - start;
    log.info(`Deterministic intent detection: ${deterministic.intent} (${duration}ms)`, {
      method: "deterministic",
    });
    return { ok: true, value: deterministic } as any;
  }

  // Optional LLM fallback – controlled by env flag
  if (env.USE_LLM_ROUTER) {
    try {
      const messages: ChatMessage[] = [
        { role: "system", content: INTENT_CLASSIFICATION_PROMPT },
        { role: "user", content: userMessage },
      ];

      const llmStart = Date.now();
      const response = await chat({
        model: Models.FAST,
        messages,
        options: {
          ...GenerationPresets.classification,
          num_predict: 100,
        },
      });
      const inferenceDuration = Date.now() - llmStart;

      const jsonMatch = response.match(/\{.*\}/s);
      if (!jsonMatch) throw new Error("No JSON in response");
      const parsed = JSON.parse(jsonMatch[0]) as IntentResult;
      const totalDuration = Date.now() - start;
      log.info(`LLM intent classification: ${parsed.intent} (${inferenceDuration}ms)`, {
        method: "llm",
        totalDuration,
      });
      return { ok: true, value: parsed } as any;
    } catch (e) {
      const duration = Date.now() - start;
      log.warn(`Intent classification LLM failed: ${e instanceof Error ? e.message : String(e)}. Falling back to chitchat. (${duration}ms)`);
      return { ok: true, value: { intent: IntentEnum.CONVERSATION, confidence: 0.5, entities: {} } } as any;
    }
  }

  // No deterministic match and LLM fallback disabled – default to chitchat
  const duration = Date.now() - start;
  log.info(`No intent match and LLM fallback disabled. Defaulting to chitchat (${duration}ms)`, {
    method: "fallback",
  });
  return { ok: true, value: { intent: IntentEnum.CONVERSATION, confidence: 0.5, entities: {} } } as any;
}
// ─── Route Request ────────────────────────────────────────────────────────────────
/**
 * Full routing pipeline:
 * 1. Classify the user's intent (deterministic first, optional LLM fallback)
 * 2. Select the appropriate model + generation preset
 * 3. Determine which agent should handle the request
 */
export async function routeRequest(
  userMessage: string
): Promise<Result<RouteDecision>> {
  return safeAsync(async () => {
    const start = Date.now();
    // Step 1: Classify intent
    const intentResult = await classifyIntent(userMessage);
    if (!intentResult.ok) throw intentResult.error;
    const intent = intentResult.value;

    // Step 2: Select model and preset
    const model = env.DEFAULT_MODEL ?? getModelForTask(intent.intent);
    const preset = getPresetKeyForIntent(intent.intent);

    // Step 3: Select agent
    const agent = INTENT_TO_AGENT[intent.intent] ?? "taskAgent";

    const decision: RouteDecision = { intent, model, preset, agent };
    const totalTime = Date.now() - start;
    log.info(`Routed → agent: ${agent}, model: ${model}, preset: ${preset}`, {
      intent: intent.intent,
      confidence: intent.confidence,
      routingTimeMs: totalTime,
    });
    return decision;
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────────

function getPresetKeyForIntent(intent: string): keyof typeof GenerationPresets {
  if (intent.includes("code") || intent.includes("git")) return "coding";
  if (
    intent === "chitchat" ||
    intent === "conversation" ||
    intent === IntentEnum.CONVERSATION ||
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
  return IntentEnum.CONVERSATION; // fallback to conversation intent
}
