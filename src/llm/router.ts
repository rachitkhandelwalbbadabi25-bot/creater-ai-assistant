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

// ─── Quick Keyword Route ─────────────────────────────────────────────────────────
function quickKeywordRoute(message: string): IntentResult | null {
  const msg = message.toLowerCase();
  
  if (msg.match(/task|todo|remind|deadline|schedule/))
    return { intent: "task_management", confidence: 0.9, entities: {} };
  
  if (msg.match(/code|fix|bug|error|function|class|import/))
    return { intent: "code_request", confidence: 0.9, entities: {} };
  
  if (msg.match(/open|close|run|execute|file|folder|browser/))
    return { intent: "system_control", confidence: 0.9, entities: {} };
  
  if (msg.match(/hello|hi|hey|how are you|kya|bhai|hii|helo/))
    return { intent: "chitchat", confidence: 0.95, entities: {} };

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
  return safeAsync(async () => {
    // Fast keyword routing — no LLM call needed
    const quickRoute = quickKeywordRoute(userMessage);
    if (quickRoute) {
      log.info(`Quick route: ${quickRoute.intent} (keyword match)`);
      return quickRoute;
    }

    const messages: ChatMessage[] = [
      { role: "system", content: INTENT_CLASSIFICATION_PROMPT },
      { role: "user", content: userMessage },
    ];

    try {
      const response = await chat({
        model: Models.FAST,
        messages,
        options: { 
          ...GenerationPresets.classification,
          num_predict: 100,
        },
        // format: "json" removed — causes hang on small Ollama models
      });

      // Safe JSON parse with regex fallback
      const jsonMatch = response.match(/\{.*\}/s);
      if (!jsonMatch) throw new Error("No JSON in response");
      const parsed = JSON.parse(jsonMatch[0]) as IntentResult;

      log.info(`Intent: ${parsed.intent} (${(parsed.confidence * 100).toFixed(0)}%)`, {
        message: userMessage.slice(0, 80),
      });
      return parsed;
    } catch (e) {
      // Fallback — don't crash, return default
      log.warn(`Intent classification failed: ${e instanceof Error ? e.message : String(e)}. Falling back to chitchat.`);
      return { intent: "chitchat", confidence: 0.5, entities: {} };
    }
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
    // Preference: Persisted Override / DEFAULT_MODEL > Auto-routing
    const model = env.DEFAULT_MODEL ?? getModelForTask(intent.intent);
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
