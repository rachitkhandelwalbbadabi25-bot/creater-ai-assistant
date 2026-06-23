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

type ContextBudgetTier = 0 | 1 | 2 | 3;
type EmotionContextTier = "simple" | "deep" | "analysis";

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

function getContextBudgetTier(input: string, intent: string): ContextBudgetTier {
  const message = input.toLowerCase();

  if (intent === "emotion_support") {
    return getEmotionContextBudgetTier(input);
  }

  if (
    intent === "task_management" ||
    intent === "scheduling" ||
    /\b(feel|sad|angry|stress|anxious|mood|tired|time|today|tomorrow|deadline|schedule|plan|remind|calendar|good night)\b/i.test(message)
  ) {
    return 3;
  }

  if (
    intent === "memory_query" ||
    intent === "project_query" ||
    intent === "code_request" ||
    /\b(remember|memory|past|previous|before|project|repo|code|bug|file)\b/i.test(message)
  ) {
    return 2;
  }

  if (intent === "knowledge_qa" || /\b(explain|why|how)\b/i.test(message)) {
    return 1;
  }

  return 1;
}

function getEmotionContextTier(input: string): EmotionContextTier {
  const message = input.toLowerCase();

  if (/\b(pattern|trend|history|profile|usually|always|these days|lately|over time|past moods?|emotion map|analyse|analyze)\b/i.test(message)) {
    return "analysis";
  }

  if (/\b(depressed|depression|hopeless|worthless|suicidal|kill myself|self harm|panic|anxiety|anxious|stressed|stress|overwhelmed|burnout|lonely|alone|nobody understands|can't cope|cannot cope|crying|broken)\b/i.test(message)) {
    return "deep";
  }

  return "simple";
}

function getEmotionContextBudgetTier(input: string): ContextBudgetTier {
  const tier = getEmotionContextTier(input);
  if (tier === "analysis") return 3;
  if (tier === "deep") return 2;
  return 1;
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

  console.time('routeRequest');
  const routeResult = await routeRequest(state.currentInput);
  console.timeEnd('routeRequest');

  const rawRoutedIntent = routeResult.ok ? routeResult.value.intent.intent : IntentEnum.CONVERSATION;
  const routedIntent = normalizeIntent(rawRoutedIntent);
  const contextIntent = rawRoutedIntent === "emotion_support" ? rawRoutedIntent : routedIntent;
  const contextBudgetTier = getContextBudgetTier(state.currentInput, contextIntent);
  let mood = state.mood;
  let energy = state.energy;
  let emotionConfidence = state.emotionConfidence;
  let emotionContextTier: EmotionContextTier | undefined;
  let contextBlock = "";
  let memoryRetrieved = false;

  if (contextIntent === "emotion_support") {
    emotionContextTier = getEmotionContextTier(state.currentInput);
    console.time('detectEmotion');
    const emotion = await detectEmotion(state.currentInput);
    console.timeEnd('detectEmotion');
    logEmotion(emotion.mood, emotion.energy, emotion.confidence, state.currentInput);
    mood = emotion.mood;
    energy = emotion.energy;
    emotionConfidence = emotion.confidence;
  }

  if (contextBudgetTier >= 2) {
    const memoryContext = await retrieveContext({
      query: state.currentInput,
      recentMessageCount: contextBudgetTier >= 3 ? 4 : 2,
      semanticResultCount: contextBudgetTier >= 3 ? 2 : 1,
      includeProfile: contextBudgetTier >= 3,
    });

    let emotionCtx = null;
    if (contextBudgetTier >= 3 && contextIntent !== "emotion_support") {
      console.time('detectEmotion');
      const emotion = await detectEmotion(state.currentInput);
      console.timeEnd('detectEmotion');
      logEmotion(emotion.mood, emotion.energy, emotion.confidence, state.currentInput);
      emotionCtx = {
        currentMood: emotion.mood,
        confidence: emotion.confidence,
        energyLevel: emotion.energy,
      };
      mood = emotion.mood;
      energy = emotion.energy;
      emotionConfidence = emotion.confidence;
    } else if (contextIntent === "emotion_support") {
      emotionCtx = {
        currentMood: mood,
        confidence: emotionConfidence,
        energyLevel: energy,
      };
    }

    const fullCtx = buildFullContext(emotionCtx, memoryContext);
    contextBlock = contextToString(fullCtx, contextBudgetTier >= 3 ? 384 : 192, {
      includeUser: false,
      includeTime: false,
      includeGreeting: false,
      includeEmotion: contextIntent === "emotion_support" || contextBudgetTier >= 3,
      includeSystemStatus: contextIntent !== "emotion_support",
      includeProfileFacts: contextIntent !== "emotion_support" && contextBudgetTier >= 3,
      includeGraphContext: false,
    });
    memoryRetrieved = true;
  }

  if (routeResult.ok) {
    const route = routeResult.value;
    return {
      ...state,
      intent: contextIntent,
      intentConfidence: route.intent.confidence,
      targetAgent: route.agent,
      selectedModel: route.model,
      mood,
      energy,
      emotionConfidence,
      emotionContextTier,
      contextBlock,
      memoryRetrieved,
      currentStep: "planning",
    };
  }

  log.warn("Routing failed - falling back to taskAgent");
  return {
    ...state,
    intent: IntentEnum.CONVERSATION, // Fallback to conversation intent instead of UNKNOWN
    intentConfidence: 0,
    targetAgent: "taskAgent",
    selectedModel: Models.PRIMARY,
    mood,
    energy,
    emotionConfidence,
    emotionContextTier,
    contextBlock,
    memoryRetrieved,
    currentStep: "planning",
  };
}
