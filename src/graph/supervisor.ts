// -----------------------------------------------------------------------------
// src/graph/supervisor.ts - Main orchestrator: routes to agents, manages flow
// -----------------------------------------------------------------------------

import { createInitialState, type GraphState } from "./state.js";
import { classifyRuntimeMode } from "../runtime/RuntimeModeClassifier.js";
import { logRuntimeFeatureFlags } from "../runtime/featureFlags.js";
import { createLogger } from "@utils/logger.js";
import { formatErrorForUser } from "@utils/errorHandler.js";

const log = createLogger("graph/supervisor");

type AgentNode = (state: GraphState) => Promise<GraphState>;

const EXECUTION_INTENTS = new Set([
  "system_command",
  "browser_command",
  "application_launch",
  "web_navigation",
]);

console.log("[PROCESSMESSAGE MODULE]", import.meta.url);

async function loadRouterNode() {
  const module = await import("./router.js");
  return module.routerNode;
}

async function loadAgentNode(agentName: string): Promise<AgentNode | null> {
  switch (agentName) {
    case "taskAgent":
      return (await import("./taskAgent.js")).taskAgentNode;
    case "emotionAgent":
      return (await import("./emotionAgent.js")).emotionAgentNode;
    case "laptopAgent":
      return (await import("./laptopAgent.js")).laptopAgentNode;
    case "projectAgent":
      return (await import("./projectAgent.js")).projectAgentNode;
    case "skillAgent":
      return (await import("./skillAgent.js")).skillAgentNode;
    default:
      return null;
  }
}

export async function processMessage(
  input: string,
  channel: GraphState["channel"] = "tui",
  onToken?: (token: string) => void
): Promise<string> {
  const startTime = Date.now();
  logRuntimeFeatureFlags();
  console.log("[SUPERVISOR ENTRY]", { channel, input });
  console.log("[ACTIVE RUNTIME PATH]", { channel, entrypoint: "processMessage" });
  console.log("[TIMING] input received", { channel, input });

  try {
    let state = createInitialState(input, channel);
    state.onToken = onToken;
    log.info(`Processing: "${input.slice(0, 80)}..." [${channel}]`);

    const runtimeMode = classifyRuntimeMode(input);
    state.runtimeMode = runtimeMode.mode;

    if (runtimeMode.mode === "execution") {
      console.log("DIRECT EXECUTION ROUTE ACTIVE", {
        channel,
        reason: runtimeMode.reason,
      });
      console.log("ROUTED TO laptopAgent");
      console.log("EXECUTION BYPASS CONFIRMED", {
        channel,
        mode: runtimeMode.mode,
      });
      console.log("CONVERSATIONAL PIPELINE SKIPPED", {
        channel,
        skipped: ["graph/router", "llm/router", "emotionAgent", "memory retrieval"],
      });
      state = {
        ...state,
        intent: runtimeMode.intent ?? "system_command",
        intentConfidence: runtimeMode.confidence,
        targetAgent: runtimeMode.targetAgent ?? "laptopAgent",
        selectedModel: runtimeMode.selectedModel ?? state.selectedModel,
        mood: "neutral",
        energy: "medium",
        emotionConfidence: 0,
        contextBlock: "",
        memoryRetrieved: false,
        currentStep: "planning",
      };
      log.info("Execution runtime mode selected", {
        input,
        intent: state.intent,
        agent: state.targetAgent,
        reason: runtimeMode.reason,
      });
      console.log("EXECUTION RUNTIME ACTIVE");
    } else {
      const routerNode = await loadRouterNode();
      state = await routerNode(state);
      log.info(`Routed -> agent=${state.targetAgent}, intent=${state.intent}, mood=${state.mood}`);
      console.log("CONVERSATIONAL RUNTIME ACTIVE");
    }

    if (EXECUTION_INTENTS.has(state.intent)) {
      console.log("[ROUTER BYPASS SUCCESS]", {
        channel,
        runtimeMode: state.runtimeMode,
        intent: state.intent,
        targetAgent: state.targetAgent,
      });
    } else {
      console.log("[LLM PATH ENTERED]", {
        channel,
        input,
        intent: state.intent,
        targetAgent: state.targetAgent,
      });
    }

    const agentFn = await loadAgentNode(state.targetAgent);
    if (!agentFn) {
      log.warn(`Unknown agent "${state.targetAgent}" - falling back to taskAgent`);
      const fallbackAgent = await loadAgentNode("taskAgent");
      if (!fallbackAgent) {
        throw new Error("taskAgent could not be loaded");
      }
      state = await fallbackAgent(state);
    } else {
      state = await agentFn(state);
    }

    if (state.requiresConfirmation && state.pendingConfirmation) {
      log.info(`Awaiting user confirmation for: ${state.pendingConfirmation.toolId}`);
      return state.response;
    }

    const elapsed = Date.now() - startTime;
    log.info(`Response generated in ${elapsed}ms`, {
      agent: state.targetAgent,
      intent: state.intent,
      mood: state.mood,
      responseLen: state.response.length,
    });
    console.log("[TIMING] frontend updated", { channel, elapsedMs: elapsed });
    return state.response;
  } catch (error) {
    log.error("Pipeline error", error);
    return formatErrorForUser(error);
  }
}

export async function processMessageStreaming(
  input: string,
  channel: GraphState["channel"] = "tui",
  onToken?: (token: string) => void
): Promise<string> {
  console.log("[ACTIVE RUNTIME PATH]", { channel, entrypoint: "processMessageStreaming" });
  return await processMessage(input, channel, onToken);
}

export async function processConfirmation(
  confirmed: boolean,
  pendingToolId: string,
  pendingParams: Record<string, unknown>
): Promise<string> {
  if (!confirmed) {
    return "Theek hai, cancel kar diya. Kuch aur chahiye?";
  }

  log.info(`User confirmed tool: ${pendingToolId}`);
  return `Running ${pendingToolId}... (tool execution coming soon)`;
}
