import { createInitialState, type GraphState } from "./state.js";
import { taskAgentNode } from "./taskAgent.js";
import { emotionAgentNode } from "./emotionAgent.js";
import { laptopAgentNode } from "./laptopAgent.js";
import { projectAgentNode } from "./projectAgent.js";
import { skillAgentNode } from "./skillAgent.js";
import { createLogger } from "@utils/logger.js";
import { formatErrorForUser } from "@utils/errorHandler.js";
import { classifyRuntimeMode } from "../runtime/RuntimeModeClassifier.js";
import { logMemorySnapshot } from "@utils/memory.js";
import { IS_RUNTIME_DEBUG, logPerf, nowMs } from "@utils/perf.js";
import { ExecutionModeEnum, IntentEnum } from "../runtime/semantic/semanticTypes.js";
import { normalizeIntent } from "../runtime/semantic/intentDetector.js";
const log = createLogger("graph/supervisor");



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
  const startedAt = nowMs();
  const runtimeClassification = classifyRuntimeMode(input);
  if (IS_RUNTIME_DEBUG) {
    log.info("RUNTIME MODE CLASSIFIER ACTIVE", { classification: runtimeClassification });
  }
  // Deterministic isolation guard: ensure downstream pipelines are skipped when in deterministic mode
  if (runtimeClassification.executionMode === ExecutionModeEnum.DETERMINISTIC) {
    if (IS_RUNTIME_DEBUG) {
      log.info("Deterministic isolation enforced for execution", { mode: runtimeClassification.executionMode });
    }
    // Additional isolation logic can be added here if needed
  }

  if (runtimeClassification.mode === "execution") {
    if (IS_RUNTIME_DEBUG) {
      log.info("Execution intent bypassing conversational routing", {
        intent: runtimeClassification.intent,
        targetAgent: runtimeClassification.targetAgent,
      });
    }

    const result = {
      state: await laptopAgentNode({
        ...state,
        currentInput: runtimeClassification.normalizedInput,
        intent: runtimeClassification.intent ? normalizeIntent(runtimeClassification.intent) : IntentEnum.SYSTEM_ACTION,
        intentConfidence: runtimeClassification.confidence,
        targetAgent: runtimeClassification.targetAgent ?? "laptopAgent",
        selectedModel: runtimeClassification.selectedModel ?? state.selectedModel,
        contextBlock: "",
        memoryRetrieved: false,
        currentStep: "executing",
        // Execution bypass flags – ensure downstream pipelines are skipped
        skipConversationPipeline: true,
        skipEmotionPipeline: true,
        skipSemanticRetrieval: true,
        allowConversationalFallback: false,
        executionSource: runtimeClassification.executionSource,
      }),
      bypassedExecution: true,
    };
    logPerf(log, "routeExecutionState completed", startedAt, { mode: runtimeClassification.mode });
    return result;
  }

  const routedState = await routeConversationalState(state);
  if (IS_RUNTIME_DEBUG) {
    log.info(`Routed -> agent=${routedState.targetAgent}, intent=${routedState.intent}, mood=${routedState.mood}`);
  }
  logPerf(log, "routeExecutionState completed", startedAt, { mode: runtimeClassification.mode });
  return { state: routedState, bypassedExecution: false };
}

export async function processMessageStreaming(
  input: string,
  channel: GraphState["channel"] = "tui",
  onToken?: (token: string) => void,
): Promise<string> {
  const startTime = nowMs();
  workflowCount++;
  if (IS_RUNTIME_DEBUG) {
    log.info("STREAMING MODE ACTIVE");
    log.info(`Workflow #${workflowCount} started`);
  }
  if (IS_RUNTIME_DEBUG) {
    logMemorySnapshot(`Workflow ${workflowCount} start`);
  }

  let state: GraphState = createInitialState(input, channel);
  try {
    state.onToken = onToken;
    if (IS_RUNTIME_DEBUG) {
      log.info(`Processing (stream): "${input.slice(0, 80)}..." [${channel}]`);
    }

    const routed = await routeExecutionState(state, input);
    state = routed.state;

    if (!routed.bypassedExecution) {
      const agentFn = AGENTS[state.targetAgent];
      state = agentFn ? await agentFn(state) : await taskAgentNode(state);
    }

    if (state.requiresConfirmation && state.pendingConfirmation) {
      return state.response;
    }

    logPerf(log, "processMessageStreaming completed", startTime, {
      agent: state.targetAgent,
      intent: state.intent,
      responseLen: state.response.length,
    });

    if (IS_RUNTIME_DEBUG) {
      logMemorySnapshot(`Workflow ${workflowCount} end`);
      if (workflowCount % 5 === 0) {
        logMemorySnapshot(`Periodic snapshot at ${workflowCount} workflows`);
      }
    }
    return state.response;
  } catch (error) {
    log.error("Streaming pipeline error", error);
    return formatErrorForUser(error);
  } finally {
    if (state) {
      state.onToken = undefined;
    }
  }
}

export async function processMessage(
  input: string,
  channel: GraphState["channel"] = "tui",
): Promise<string> {
  const startTime = nowMs();
  workflowCount++;
  if (IS_RUNTIME_DEBUG) {
    log.info(`Workflow #${workflowCount} started`);
  }
  if (IS_RUNTIME_DEBUG) {
    logMemorySnapshot(`Workflow ${workflowCount} start`);
  }

  let state: GraphState | undefined;
  try {
    // Initialize the graph state before routing
    state = createInitialState(input, channel);

    if (IS_RUNTIME_DEBUG) {
      log.info(`Processing: "${input.slice(0, 80)}..." [${channel}]`);
    }

    const routed = await routeExecutionState(state, input);
    state = routed.state;

    if (!routed.bypassedExecution) {
      const agentFn = AGENTS[state.targetAgent];
      state = agentFn ? await agentFn(state) : await taskAgentNode(state);
    }

    if (state.requiresConfirmation && state.pendingConfirmation) {
      return state.response;
    }

    logPerf(log, "processMessage completed", startTime, {
      agent: state.targetAgent,
      intent: state.intent,
      responseLen: state.response.length,
    });

    if (IS_RUNTIME_DEBUG) {
      logMemorySnapshot(`Workflow ${workflowCount} end`);
      if (workflowCount % 5 === 0) {
        logMemorySnapshot(`Periodic snapshot at ${workflowCount} workflows`);
      }
    }
    return state.response;
  } catch (error) {
    log.error("Pipeline error", error);
    return formatErrorForUser(error);
  } finally {
    if (state) {
      state.onToken = undefined;
    }
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

  if (IS_RUNTIME_DEBUG) {
    log.info(`User confirmed tool: ${pendingToolId}`, { pendingParams });
  }
  return `✅ Running ${pendingToolId}... (tool execution coming soon)`;
}
