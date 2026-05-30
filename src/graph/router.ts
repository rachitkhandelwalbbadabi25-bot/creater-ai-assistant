// ════════════════════════════════════════════════════════════════════════════════
// src/graph/router.ts — Intent classification + agent routing node
// First node in the graph — determines which agent handles the request.
// ════════════════════════════════════════════════════════════════════════════════

import type { GraphState } from "./state.js";
import { Models } from "@config/models.js";
import { routeRequest } from "@llm/router.js";
import { detectEmotion } from "@emotion/detector.js";
import { logEmotion } from "@emotion/personalMap.js";
import { retrieveContext } from "@memory/retriever.js";
import { contextToString, buildFullContext } from "@utils/contextBuilder.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("graph/router");

/**
 * Router node — the first step in the agent graph.
 *
 * Performs:
 * 1. Emotion detection (hybrid: keywords + ML)
 * 2. Intent classification (fast LLM)
 * 3. Memory retrieval (RAG)
 * 4. Context assembly
 * 5. Agent selection
 */
export async function routerNode(state: GraphState): Promise<GraphState> {
  log.info(`Routing: "${state.currentInput.slice(0, 80)}"`);

  const normalizedInput = state.currentInput.toLowerCase().trim().replace(/[^\w\s]/g, "");
  const isSimpleChitchat = normalizedInput === "hello" ||
                           normalizedInput === "hi" ||
                           normalizedInput === "hey" ||
                           normalizedInput === "how are you" ||
                           normalizedInput === "thanks" ||
                           normalizedInput === "okay" ||
                           normalizedInput.startsWith("hello ") ||
                           normalizedInput.startsWith("hi ") ||
                           normalizedInput.includes("how are you") ||
                           normalizedInput.startsWith("thanks") ||
                           normalizedInput === "ok";

  // ── 1. Emotion detection (parallel with routing) ───────────────────────────
  const emotionPromise = detectEmotion(state.currentInput);

  // ── 2. Intent classification + model selection ─────────────────────────────
  let routeResult;
  if (isSimpleChitchat) {
    routeResult = {
      ok: true,
      value: {
        intent: { intent: "chitchat", confidence: 1.0 },
        agent: "taskAgent",
        model: state.selectedModel || Models.PRIMARY,
      }
    };
  } else {
    routeResult = await routeRequest(state.currentInput);
  }

  // ── 3. Get emotion result ──────────────────────────────────────────────────
  const emotion = await emotionPromise;

  // Log emotion to history
  logEmotion(emotion.mood, emotion.energy, emotion.confidence, state.currentInput);

  // ── 4. Memory retrieval ────────────────────────────────────────────────────
  const memoryContext = await retrieveContext({
    query: state.currentInput,
    recentMessageCount: isSimpleChitchat ? 2 : 8,
    semanticResultCount: isSimpleChitchat ? 0 : 4,
    includeProfile: !isSimpleChitchat,
  });

  // ── 5. Build context block ─────────────────────────────────────────────────
  const emotionCtx = {
    currentMood: emotion.mood,
    confidence: emotion.confidence,
    energyLevel: emotion.energy,
  };
  const fullCtx = buildFullContext(emotionCtx, memoryContext);
  const contextBlock = contextToString(fullCtx);

  // ── 6. Assemble updated state ──────────────────────────────────────────────
  if (routeResult.ok) {
    const route = routeResult.value;
    return {
      ...state,
      intent: route.intent.intent,
      intentConfidence: route.intent.confidence,
      targetAgent: route.agent,
      selectedModel: route.model,
      mood: emotion.mood,
      energy: emotion.energy,
      emotionConfidence: emotion.confidence,
      contextBlock,
      memoryRetrieved: true,
      currentStep: "planning",
    };
  }

  // Routing failed — fall back to taskAgent with primary model
  log.warn("Routing failed — falling back to taskAgent");
  return {
    ...state,
    intent: "unknown",
    intentConfidence: 0,
    targetAgent: "taskAgent",
    selectedModel: Models.PRIMARY,
    mood: emotion.mood,
    energy: emotion.energy,
    emotionConfidence: emotion.confidence,
    contextBlock,
    memoryRetrieved: true,
    currentStep: "planning",
  };
}
