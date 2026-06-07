import { createInitialState, type GraphState } from "./state.js";
import { taskAgentNode } from "./taskAgent.js";
import { emotionAgentNode } from "./emotionAgent.js";
import { laptopAgentNode } from "./laptopAgent.js";
import { projectAgentNode } from "./projectAgent.js";
import { skillAgentNode } from "./skillAgent.js";

import { createLogger } from "@utils/logger.js";
import { formatErrorForUser } from "@utils/errorHandler.js";
import { classifyRuntimeMode } from "../runtime/RuntimeModeClassifier.js";

// Memory observability
import { logMemorySnapshot } from "@utils/memory.js";

const log = createLogger("graph/supervisor");

// Simple workflow counter for periodic memory snapshots
let workflowCount = 0;

type AgentNode = (state: GraphState) => Promise<GraphState>;

const AGENTS: Record<string, AgentNode> = {
  taskAgent: taskAgentNode,
  emotionAgent: emotionAgentNode,
  laptopAgent: laptopAgentNode,
  projectAgent: projectAgentNode,
  skillAgent: skillAgentNode,
};

async function routeConversationalState(state: GraphState): Promise<GraphState> {
  const { routerNode } = await import("./router.js");
  return routerNode(state);
}

async function routeExecutionState(
  state: GraphState,
  input: string,
): Promise<{ state: GraphState; bypassedExecution: boolean }> {
  const runtimeClassification = classifyRuntimeMode(input);
  console.log("RUNTIME MODE CLASSIFIER ACTIVE");
  log.info("RUNTIME MODE CLASSIFIER ACTIVE", { classification: runtimeClassification });

  if (runtimeClassification.mode === "execution") {
    console.log("EXECUTION MODE ACTIVE");
    console.log("DIRECT EXECUTION ROUTE ACTIVE");
    console.log("EXECUTION BYPASS CONFIRMED");
    console.log("CONVERSATIONAL PIPELINE SKIPPED");
    if (runtimeClassification.intent === "web_search" || runtimeClassification.intent === "web_navigation") {
      console.log("EXECUTION SEARCH BYPASS ACTIVE");
      log.info("Execution intent bypassing conversational routing", {
        intent: runtimeClassification.intent,
        targetAgent: runtimeClassification.targetAgent,
      });
    }

    return {
      state: await laptopAgentNode({
        ...state,
        currentInput: runtimeClassification.normalizedInput,
        intent: runtimeClassification.intent ?? "system_control",
        intentConfidence: runtimeClassification.confidence,
        targetAgent: runtimeClassification.targetAgent ?? "laptopAgent",
        selectedModel: runtimeClassification.selectedModel ?? state.selectedModel,
        contextBlock: "",
        memoryRetrieved: false,
        currentStep: "executing",
      }),
      bypassedExecution: true,
    };
  }

  const routedState = await routeConversationalState(state);
  log.info(`Routed -> agent=${routedState.targetAgent}, intent=${routedState.intent}, mood=${routedState.mood}`);
  return { state: routedState, bypassedExecution: false };
}

export async function processMessageStreaming(
  input: string,
  channel: GraphState["channel"] = "tui",
  onToken?: (token: string) => void,
): Promise<string> {
  const startTime = Date.now();
  log.info("STREAMING MODE ACTIVE");

  // Memory snapshot at start of workflow
  workflowCount++;
  log.info(`Workflow #${workflowCount} started`);
  logMemorySnapshot(`Workflow ${workflowCount} start`);

  let state: GraphState | undefined;
  try {
    state = createInitialState(input, channel);
    state.onToken = onToken;
    log.info(`Processing (stream): "${input.slice(0, 80)}..." [${channel}]`);

    const routed = await routeExecutionState(state, input);
    state = routed.state;

    if (!routed.bypassedExecution) {
      const agentFn = AGENTS[state.targetAgent];
      if (!agentFn) {
        log.warn(`Unknown agent "${state.targetAgent}" - falling back to taskAgent`);
        state = await taskAgentNode(state);
      } else {
        state = await agentFn(state);
      }
    }

    if (state.requiresConfirmation && state.pendingConfirmation) {
      log.info(`Awaiting user confirmation for: ${state.pendingConfirmation.toolId}`);
      return state.response;
    }

    const elapsed = Date.now() - startTime;
    log.info(`Streaming response generated in ${elapsed}ms`, {
      agent: state.targetAgent,
      intent: state.intent,
      mood: state.mood,
      responseLen: state.response.length,
    });

    // End of workflow memory snapshot
    logMemorySnapshot(`Workflow ${workflowCount} end`);
    if (workflowCount % 5 === 0) {
      log.info(`Periodic memory snapshot after ${workflowCount} workflows`);
      logMemorySnapshot(`Periodic snapshot at ${workflowCount} workflows`);
    }

    return state.response;
  } catch (error) {
    log.error("Streaming pipeline error", error);
    return formatErrorForUser(error);
  } finally {
    if (state) {
      state.onToken = undefined;
    }
    log.info("STREAMING CLEANUP: token handler cleared");
  }
}

export async function processMessage(
  input: string,
  channel: GraphState["channel"] = "tui",
): Promise<string> {
  const startTime = Date.now();

  // Memory snapshot at start of workflow
  workflowCount++;
  log.info(`Workflow #${workflowCount} started`);
  logMemorySnapshot(`Workflow ${workflowCount} start`);

  try {
    let state = createInitialState(input, channel);
    log.info(`Processing: "${input.slice(0, 80)}..." [${channel}]`);

    const routed = await routeExecutionState(state, input);
    state = routed.state;

    if (!routed.bypassedExecution) {
      const agentFn = AGENTS[state.targetAgent];
      if (!agentFn) {
        log.warn(`Unknown agent "${state.targetAgent}" - falling back to taskAgent`);
        state = await taskAgentNode(state);
      } else {
        state = await agentFn(state);
      }
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

    // End of workflow memory snapshot
    logMemorySnapshot(`Workflow ${workflowCount} end`);
    if (workflowCount % 5 === 0) {
      log.info(`Periodic memory snapshot after ${workflowCount} workflows`);
      logMemorySnapshot(`Periodic snapshot at ${workflowCount} workflows`);
    }

    return state.response;
  } catch (error) {
    log.error("Pipeline error", error);
    return formatErrorForUser(error);
  } finally {
    // No token handler in non‑streaming path, nothing to clear
  }
}

export async function processConfirmation(
  confirmed: boolean,
  pendingToolId: string,
  pendingParams: Record<string, unknown>,
): Promise<string> {
  if (!confirmed) {
    return "👍 Theek hai, cancel kar diya. Kuch aur chahiye?";
  }

  log.info(`User confirmed tool: ${pendingToolId}`, { pendingParams });
  return `✅ Running ${pendingToolId}... (tool execution coming soon)`;
}
