import type { GraphState } from "./state.js";
import { Models } from "@config/models.js";
import { normalizeCommandInput, routeFastCommand } from "./commandRouter.js";
import { routeRequest } from "@llm/router.js";
import { detectEmotion } from "@emotion/detector.js";
import { logEmotion } from "@emotion/personalMap.js";
import { retrieveContext } from "@memory/retriever.js";
import { contextToString, buildFullContext } from "@utils/contextBuilder.js";
import { createLogger } from "@utils/logger.js";
import type { Mood, EnergyLevel } from "@emotion/keywords.js";

const log = createLogger("graph/router");

console.log("ACTIVE ROUTER MODULE LOADED", import.meta.url);
console.log("DETERMINISTIC ROUTER ACTIVE");

type DeterministicRoute = {
  intent: "system_command" | "browser_command" | "application_launch" | "web_navigation";
  confidence: number;
  targetAgent: "laptopAgent";
  selectedModel: string;
  reason: string;
};

function normalizeExecutionInput(input: string): string {
  return normalizeCommandInput(input);
}

function detectDeterministicExecutionIntent(input: string): DeterministicRoute | null {
  const normalized = normalizeExecutionInput(input);
  const fastCommand = routeFastCommand(input);

  if (fastCommand) {
    if (fastCommand.kind === "open_url" || fastCommand.kind === "browser_home" || fastCommand.kind === "youtube") {
      return {
        intent: "web_navigation",
        confidence: 0.99,
        targetAgent: "laptopAgent",
        selectedModel: Models.FAST,
        reason: `fast-command:${fastCommand.kind}`,
      };
    }

    if (fastCommand.kind === "open_app") {
      return {
        intent: "application_launch",
        confidence: 0.99,
        targetAgent: "laptopAgent",
        selectedModel: Models.FAST,
        reason: `fast-command:${fastCommand.kind}`,
      };
    }

    return {
      intent: "system_command",
      confidence: 0.99,
      targetAgent: "laptopAgent",
      selectedModel: Models.FAST,
      reason: `fast-command:${fastCommand.kind}`,
    };
  }

  if (/^(search|google|search google|find on google)\s+/i.test(normalized)) {
    return {
      intent: "browser_command",
      confidence: 0.98,
      targetAgent: "laptopAgent",
      selectedModel: Models.FAST,
      reason: "search-command",
    };
  }

  if (/^(open|launch|start)\s+(browser|web browser|settings?)$/i.test(normalized)) {
    return {
      intent: "browser_command",
      confidence: 0.98,
      targetAgent: "laptopAgent",
      selectedModel: Models.FAST,
      reason: "browser-launch-command",
    };
  }

  if (/^(shutdown|restart|reboot|sleep|lock|sign out|log out)$/i.test(normalized)) {
    return {
      intent: "system_command",
      confidence: 0.98,
      targetAgent: "laptopAgent",
      selectedModel: Models.FAST,
      reason: "system-power-command",
    };
  }

  if (/^(screenshot|take screenshot|capture screen)$/i.test(normalized)) {
    return {
      intent: "system_command",
      confidence: 0.98,
      targetAgent: "laptopAgent",
      selectedModel: Models.FAST,
      reason: "screenshot-command",
    };
  }

  if (/^(volume up|volume down|mute|unmute|increase volume|decrease volume|toggle mute)$/i.test(normalized)) {
    return {
      intent: "system_command",
      confidence: 0.99,
      targetAgent: "laptopAgent",
      selectedModel: Models.FAST,
      reason: "volume-command",
    };
  }

  return null;
}

async function routeConversationalRequest(state: GraphState): Promise<GraphState> {
  const routeResult = await routeRequest(state.currentInput);
  if (!routeResult.ok) {
    log.warn("Routing failed - falling back to taskAgent");
    return {
      ...state,
      intent: "unknown",
      intentConfidence: 0,
      targetAgent: "taskAgent",
      selectedModel: Models.PRIMARY,
      mood: "neutral",
      energy: "medium",
      emotionConfidence: 0,
      contextBlock: "",
      memoryRetrieved: false,
      currentStep: "planning",
    };
  }

  const route = routeResult.value;
  const needsEmotion = route.intent.intent === "chitchat" || route.intent.intent === "emotion_support";

  log.info("Conversational routing decision", {
    input: state.currentInput,
    intent: route.intent.intent,
    confidence: route.intent.confidence,
    agent: route.agent,
  });

  let emotion: { mood: Mood; energy: EnergyLevel; confidence: number } = {
    mood: "neutral",
    energy: "medium",
    confidence: 0,
  };
  let contextBlock = "";

  if (needsEmotion) {
    const [detectedEmotion, memoryContext] = await Promise.all([
      detectEmotion(state.currentInput),
      retrieveContext({
        query: state.currentInput,
        recentMessageCount: 8,
        semanticResultCount: 4,
      }),
    ]);

    emotion = detectedEmotion;
    logEmotion(emotion.mood, emotion.energy, emotion.confidence, state.currentInput);
    contextBlock = contextToString(
      buildFullContext(
        {
          currentMood: emotion.mood,
          confidence: emotion.confidence,
          energyLevel: emotion.energy,
        },
        memoryContext
      )
    );
  }

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
    memoryRetrieved: needsEmotion,
    currentStep: "planning",
  };
}

export async function routerNode(state: GraphState): Promise<GraphState> {
  log.info(`Routing: "${state.currentInput.slice(0, 80)}"`);
  console.log("[TIMING] input received", { source: "router", command: state.currentInput });
  console.log("NORMALIZED INPUT", normalizeExecutionInput(state.currentInput));

  const deterministicRoute = detectDeterministicExecutionIntent(state.currentInput);
  if (deterministicRoute) {
    log.info("DETERMINISTIC COMMAND DETECTED", {
      input: state.currentInput,
      intent: deterministicRoute.intent,
      confidence: deterministicRoute.confidence,
      reason: deterministicRoute.reason,
    });
    console.log("DETERMINISTIC COMMAND DETECTED", {
      input: state.currentInput,
      intent: deterministicRoute.intent,
    });
    console.log("EXECUTION INTENT CONFIDENCE", deterministicRoute.confidence);
    console.log("EXECUTION MATCH SUCCESS", deterministicRoute.reason);
    console.log("ROUTER SHORT-CIRCUIT ACTIVE", {
      input: state.currentInput,
      reason: deterministicRoute.reason,
    });
    console.log("ROUTED TO EXECUTION AGENT", deterministicRoute.targetAgent);

    return {
      ...state,
      intent: deterministicRoute.intent,
      intentConfidence: deterministicRoute.confidence,
      targetAgent: deterministicRoute.targetAgent,
      selectedModel: deterministicRoute.selectedModel,
      mood: "neutral",
      energy: "medium",
      emotionConfidence: 0,
      contextBlock: "",
      memoryRetrieved: false,
      currentStep: "planning",
    };
  }

  return routeConversationalRequest(state);
}
