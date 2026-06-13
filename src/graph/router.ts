import { IntentEnum } from "../runtime/semantic/semanticTypes.js";
import { normalizeIntent } from "../runtime/semantic/intentDetector.js";
import { type GraphState } from "./state.js";
import { Models } from "@config/models.js";
import { routeRequest } from "@llm/router.js";
import { detectEmotion } from "@emotion/detector.js";
import { logEmotion } from "@emotion/personalMap.js";
import { retrieveContext } from "@memory/retriever.js";
import { contextToString, buildFullContext } from "@utils/contextBuilder.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("graph/router");

function shouldBypassConversationalRouting(state: GraphState): boolean {
  return (
    state.allowConversationalFallback === false ||
    state.currentStep === "executing" ||
    state.intent === "system_control" ||
    state.intent === "browser_action" ||
    state.intent === "file_operation" ||
    state.intent === "web_navigation" ||
    state.intent === IntentEnum.BROWSER_SEARCH
  );
}

export async function routerNode(state: GraphState): Promise<GraphState> {
  log.info(`Routing: "${state.currentInput.slice(0, 80)}"`);

  if (shouldBypassConversationalRouting(state)) {
    log.info("EXECUTION SEARCH BYPASS ACTIVE", {
      intent: state.intent,
      currentStep: state.currentStep,
    });
    return {
      ...state,
      targetAgent: state.targetAgent || "laptopAgent",
      selectedModel: state.selectedModel || Models.FAST,
      contextBlock: state.contextBlock || "",
      memoryRetrieved: state.memoryRetrieved,
      currentStep: state.currentStep === "executing" ? "executing" : "planning",
    };
  }

  const emotionPromise = detectEmotion(state.currentInput);
  const routeResult = await routeRequest(state.currentInput);
  const emotion = await emotionPromise;

  logEmotion(emotion.mood, emotion.energy, emotion.confidence, state.currentInput);

  const memoryContext = await retrieveContext({
    query: state.currentInput,
    recentMessageCount: 8,
    semanticResultCount: 4,
  });

  const emotionCtx = {
    currentMood: emotion.mood,
    confidence: emotion.confidence,
    energyLevel: emotion.energy,
  };
  const fullCtx = buildFullContext(emotionCtx, memoryContext);
  const contextBlock = contextToString(fullCtx);

  if (routeResult.ok) {
    const route = routeResult.value;
    return {
      ...state,
      intent: normalizeIntent(route.intent.intent),
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

  log.warn("Routing failed - falling back to taskAgent");
  return {
    ...state,
    intent: IntentEnum.UNKNOWN,
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
