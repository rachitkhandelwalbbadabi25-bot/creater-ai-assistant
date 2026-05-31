// src/graph/supervisor.ts - Main orchestrator: routes to agents, manages flow
// This is the entry point for processing any user message.

import { createInitialState, type GraphState } from "./state.js";
import { taskAgentNode } from "./taskAgent.js";
import { emotionAgentNode } from "./emotionAgent.js";
import { laptopAgentNode } from "./laptopAgent.js";
import { projectAgentNode } from "./projectAgent.js";
import { skillAgentNode } from "./skillAgent.js";

import { createLogger } from "@utils/logger.js";
import { formatErrorForUser } from "@utils/errorHandler.js";
import { parseExecutionPlan } from "../runtime/deterministicOrchestration/parser.ts";
import { executeWorkflow } from "../runtime/deterministicOrchestration/orchestrator.ts";
import { classifyRuntimeMode, isExecutionRuntimeMode } from "../runtime/RuntimeModeClassifier.js";

const log = createLogger("graph/supervisor");

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

// ─── Deterministic workflow path ──────────────────────────────────────────────

async function runDeterministicWorkflow(
  state: GraphState,
  normalizedInput: string
): Promise<GraphState> {
  console.log("[EXECUTION WORKFLOW ENGINE] ACTIVATED");
  console.log("[EXECUTION BYPASS CONFIRMED] conversational pipeline skipped");

  const plan = parseExecutionPlan(normalizedInput);

  // Multi-step: delegate entirely to the deterministic workflow engine
  if (plan.steps.length > 1) {
    console.log(`[EXECUTION WORKFLOW ENGINE] multi-step plan: ${plan.steps.length} steps`);
    log.info("Deterministic multi-step workflow started", {
      steps: plan.steps.map((s) => s.command),
    });

    const workflowResult = await executeWorkflow(plan);

    return {
      ...state,
      response: workflowResult.summary,
      currentStep: "done",
      targetAgent: "laptopAgent",
    };
  }

  // Single-step: try the workflow engine first; if it can resolve, use it.
  // Otherwise fall back to laptopAgent (which handles LLM-based tool selection).
  const singlePlan = { steps: [{ command: normalizedInput }] };
  const singleResult = await executeWorkflow(singlePlan);

  // If the engine resolved the tool successfully, return its result directly
  if (singleResult.stepResults[0]?.success) {
    log.info("Deterministic single-step succeeded", { summary: singleResult.summary });
    return {
      ...state,
      response: singleResult.summary,
      currentStep: "done",
      targetAgent: "laptopAgent",
    };
  }

  // Engine could not resolve deterministically → hand off to laptopAgent
  log.info("Step unresolved by engine — falling back to laptopAgent", {
    command: normalizedInput,
  });
  return laptopAgentNode({
    ...state,
    currentInput: normalizedInput,
    currentStep: "executing",
    targetAgent: "laptopAgent",
  });
}

// ─── Route entry point ────────────────────────────────────────────────────────

async function routeExecutionState(
  state: GraphState,
  input: string
): Promise<{ state: GraphState; bypassedExecution: boolean }> {
  const runtimeClassification = classifyRuntimeMode(input);
  console.log("RUNTIME MODE CLASSIFIER ACTIVE");
  log.info("RUNTIME MODE CLASSIFIER ACTIVE", { classification: runtimeClassification });

  if (isExecutionRuntimeMode(runtimeClassification.mode)) {
    console.log("EXECUTION MODE ACTIVE");
    console.log("DIRECT EXECUTION ROUTE ACTIVE");

    const updatedState = await runDeterministicWorkflow(
      {
        ...state,
        intent: runtimeClassification.intent ?? "system_control",
        intentConfidence: runtimeClassification.confidence,
        targetAgent: runtimeClassification.targetAgent ?? "laptopAgent",
        selectedModel: runtimeClassification.selectedModel ?? state.selectedModel,
        contextBlock: "",
        memoryRetrieved: false,
        currentInput: runtimeClassification.normalizedInput,
      },
      runtimeClassification.normalizedInput
    );

    return { state: updatedState, bypassedExecution: true };
  }

  const routedState = await routeConversationalState(state);
  log.info(`Routed -> agent=${routedState.targetAgent}, intent=${routedState.intent}, mood=${routedState.mood}`);
  return { state: routedState, bypassedExecution: false };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function processMessageStreaming(
  input: string,
  channel: GraphState["channel"] = "tui",
  onToken?: (token: string) => void
): Promise<string> {
  const startTime = Date.now();
  log.info("STREAMING MODE ACTIVE");

  try {
    let state = createInitialState(input, channel);
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
    return state.response;
  } catch (error) {
    log.error("Streaming pipeline error", error);
    return formatErrorForUser(error);
  }
}

export async function processMessage(
  input: string,
  channel: GraphState["channel"] = "tui"
): Promise<string> {
  const startTime = Date.now();

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
    return state.response;
  } catch (error) {
    log.error("Pipeline error", error);
    return formatErrorForUser(error);
  }
}

export async function processConfirmation(
  confirmed: boolean,
  pendingToolId: string,
  pendingParams: Record<string, unknown>
): Promise<string> {
  if (!confirmed) {
    return "👍 Theek hai, cancel kar diya. Kuch aur chahiye?";
  }

  log.info(`User confirmed tool: ${pendingToolId}`, { pendingParams });
  return `✅ Running ${pendingToolId}... (tool execution coming soon)`;
}
