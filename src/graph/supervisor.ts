import { createInitialState, type GraphState } from "./state.js";
import { taskAgentNode } from "./taskAgent.js";
import { emotionAgentNode } from "./emotionAgent.js";
import { laptopAgentNode } from "./laptopAgent.js";
import { projectAgentNode } from "./projectAgent.js";
import { skillAgentNode } from "./skillAgent.js";
import { createLogger } from "@utils/logger.js";
import plannerAgentNode from "../agents/plannerAgent.js";
import { formatErrorForUser } from "@utils/errorHandler.js";
import { classifyRuntimeMode } from "../runtime/RuntimeModeClassifier.js";
import { logMemorySnapshot } from "@utils/memory.js";
import { IS_RUNTIME_DEBUG, logPerf, nowMs } from "@utils/perf.js";
import { ExecutionModeEnum, IntentEnum } from "../runtime/semantic/semanticTypes.js";
import { normalizeIntent } from "../runtime/semantic/intentDetector.js";
import { addMessage } from "@memory/shortTerm.js";
import { detectComplexity } from "../orchestration/complexityDetector.js";
import executionAgentNode from "../agents/executionAgent.js";
import { runAgentBus } from "../orchestration/agentBus.js";

const log = createLogger("graph/supervisor");

// Wrapper to adapt GraphState to plannerAgentNode signature
async function plannerAgentWrapper(state: GraphState): Promise<GraphState> {
  try {
    log.info('[PLANNER_WRAPPER_START]');
    // Minimal shared context for plannerAgent
    const context = {
      requestId: `planner-${Date.now()}`,
      executionMode: "legacy" as const,
      userGoal: state.currentInput,
    };
    // Call plannerAgentNode (default export) which returns PlannerOutput
    const result = await plannerAgentNode(context);
    log.info('[PLANNER_WRAPPER_AFTER_AGENT]');
    // Store planner output in the graph state for downstream agents
    state.plan = result.result.steps;
    log.info('[PLANNER_WRAPPER_AFTER_PLAN]');
    // Optionally set a provisional response indicating planning completed
    state.response = "Planner generated plan.";
    // After planning, forward to taskAgent for execution
    state.targetAgent = "taskAgent";
    log.info('[PLANNER_WRAPPER_RETURN]');
    return state;
  } catch (err) {
    log.error('[PLANNER_WRAPPER_ERROR]', err);
    throw err;
  }
}

// Wrapper to adapt GraphState to executionAgentNode signature
async function executionAgentWrapper(state: GraphState): Promise<GraphState> {
  const requestId = `exec-${Date.now()}`;
  log.info('[EXECUTION_AGENT_DISPATCH]', { requestId, userGoal: state.currentInput });
  log.info('[EXECUTION_AGENT_START]', { requestId });
  const context = {
    requestId,
    executionMode: "legacy" as const,
    userGoal: state.currentInput,
    plan: state.plan,
    // executionAgent reads context.plannerAgentOutput?.steps — wire it here
    plannerAgentOutput: { steps: state.plan ?? [] },
  };
  const { result } = await executionAgentNode(context);

  const finalOutput = result.outputs?.[result.outputs.length - 1];
  if (finalOutput && finalOutput.status === "success" && finalOutput.detail) {
    state.response = finalOutput.detail;
  } else if (result && result.stepsExecuted?.length) {
    state.response = `Executed steps: ${result.stepsExecuted.join(', ')}`;
  }
  // Ensure the redispatch loop exits
  state.targetAgent = "";
  return state;
}


const MODULE_INSTANCE_ID = Math.random().toString(36).slice(2);
console.log("[MODULE_INSTANCE]", { file: "supervisor.ts", event: "load", id: MODULE_INSTANCE_ID });

let workflowCount = 0;

type AgentNode = (state: GraphState) => Promise<GraphState>;

const AGENTS: Record<string, AgentNode> = {
  taskAgent: taskAgentNode,
  emotionAgent: emotionAgentNode,
  laptopAgent: laptopAgentNode,
  projectAgent: projectAgentNode,
  plannerAgent: plannerAgentWrapper,
  executionAgent: executionAgentWrapper,
  skillAgent: skillAgentNode,
};

function getDeterministicConversationReply(input: string): string | null {
  const normalized = input.trim().toLowerCase().replace(/[!.?]+$/g, "");
  const replies: Record<string, string> = {
    hi: "Hi! How can I help?",
    hello: "Hello! How can I help?",
    hey: "Hey! How can I help?",
    "good morning": "Good morning! How can I help?",
    "good night": "Good night! Rest well.",
    thanks: "You're welcome.",
    "thank you": "You're welcome.",
  };

  return replies[normalized] ?? null;
}

function persistDeterministicConversation(input: string, response: string, channel: GraphState["channel"]): void {
  addMessage("user", input, channel, { intent: "conversation" });
  addMessage("assistant", response, channel);
}

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

  console.log(`[INTENT_BEFORE_ROUTER] requestId=N/A intent=${state.intent} targetAgent=${state.targetAgent} currentStep=${state.currentStep} selectedModel=${state.selectedModel}`);
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
    console.log(`[INTENT_AFTER_ROUTER] bypassedExecution=true requestId=N/A intent=${result.state.intent} targetAgent=${result.state.targetAgent} currentStep=${result.state.currentStep} selectedModel=${result.state.selectedModel}`);
    logPerf(log, "routeExecutionState completed", startedAt, { mode: runtimeClassification.mode });
    return result;
  }

  // Set intent to conversation for non‑execution modes to avoid UNKNOWN logs
  const routedState = await routeConversationalState({ ...state, intent: IntentEnum.CONVERSATION });
  console.log(`[INTENT_AFTER_ROUTER] bypassedExecution=false requestId=N/A intent=${routedState.intent} targetAgent=${routedState.targetAgent} currentStep=${routedState.currentStep} selectedModel=${routedState.selectedModel}`);
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
  const requestId = `stream-${Date.now()}`;
  console.log("[MODULE_INSTANCE]", { file: "supervisor.ts", event: "start", id: MODULE_INSTANCE_ID, requestId });
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

    const deterministicReply = getDeterministicConversationReply(input);
    if (deterministicReply) {
      state.response = deterministicReply;
      state.intent = IntentEnum.CONVERSATION;
      state.targetAgent = "deterministic";
      state.currentStep = "done";
      persistDeterministicConversation(input, deterministicReply, channel);
      onToken?.(deterministicReply);
      logPerf(log, "processMessageStreaming completed", startTime, {
        agent: state.targetAgent,
        intent: state.intent,
        responseLen: state.response.length,
        bypass: "deterministic_conversation",
      });
      return deterministicReply;
    }

    const compResult = detectComplexity(input);
    if (compResult.mode === "multi-agent") {
      const multiAgentResponse = await runAgentBus({ userGoal: input, requestId });
      state.response = multiAgentResponse;
      onToken?.(multiAgentResponse);
    } else {
      const routed = await routeExecutionState(state, input);
      state = routed.state;

      if (!routed.bypassedExecution) {
        const agentFn = AGENTS[state.targetAgent];
      if (state.targetAgent === "plannerAgent") {
        log.info("[PLANNER_AGENT_DISPATCH]", { requestId, intent: state.intent, targetAgent: state.targetAgent });
      }
        state = agentFn ? await agentFn(state) : await taskAgentNode(state);
      }
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
    console.log("[MODULE_INSTANCE]", { file: "supervisor.ts", event: "end", id: MODULE_INSTANCE_ID, requestId });
  }
}

export async function processMessage(
  input: string,
  channel: GraphState["channel"] = "tui",
): Promise<string> {
  const requestId = `msg-${Date.now()}`;
  console.log("[MODULE_INSTANCE]", { file: "supervisor.ts", event: "start", id: MODULE_INSTANCE_ID, requestId });
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

    const deterministicReply = getDeterministicConversationReply(input);
    if (deterministicReply) {
      state.response = deterministicReply;
      state.intent = IntentEnum.CONVERSATION;
      state.targetAgent = "deterministic";
      state.currentStep = "done";
      persistDeterministicConversation(input, deterministicReply, channel);
      logPerf(log, "processMessage completed", startTime, {
        agent: state.targetAgent,
        intent: state.intent,
        responseLen: state.response.length,
        bypass: "deterministic_conversation",
      });
      return deterministicReply;
    }

    const compResult = detectComplexity(input);
    if (compResult.mode === "multi-agent") {
      const multiAgentResponse = await runAgentBus({ userGoal: input, requestId });
      state.response = multiAgentResponse;
    } else {
      const routed = await routeExecutionState(state, input);
      state = routed.state;

      if (!routed.bypassedExecution) {
        // --- Begin redispatch loop ---
        let currentAgent = state.targetAgent;
    log.info('[REDISPATCH_LOOP]');
        const maxRedispatch = 10; // safeguard against infinite loops
        let redispatchCount = 0;
        while (true) {
          const executedAgent = currentAgent;
          const agentFn = AGENTS[executedAgent] ?? taskAgentNode;
          log.info('[AGENT_DISPATCH]', { agent: executedAgent });
          console.log(`[INTENT_BEFORE_SUPERVISOR] requestId=${requestId} intent=${state.intent} targetAgent=${state.targetAgent} currentStep=${state.currentStep} selectedModel=${state.selectedModel}`);
          state = await agentFn(state);
          console.log(`[INTENT_AFTER_SUPERVISOR] requestId=${requestId} intent=${state.intent} targetAgent=${state.targetAgent} currentStep=${state.currentStep} selectedModel=${state.selectedModel}`);
          // If no further target change or same agent, stop
          if (!state.targetAgent || state.targetAgent === executedAgent) {
            break;
          }
          // Prevent runaway loops
          if (++redispatchCount > maxRedispatch) {
            log.warn('[REDISPATCH_LIMIT]', { from: executedAgent, to: state.targetAgent });
            break;
          }
          const nextAgent = state.targetAgent;
          log.info('[REDISPATCH]', { from: executedAgent, to: nextAgent });
          currentAgent = nextAgent;
        }
        // --- End redispatch loop ---
      }
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
    console.log("[MODULE_INSTANCE]", { file: "supervisor.ts", event: "end", id: MODULE_INSTANCE_ID, requestId });
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

  log.info(`User confirmed tool execution: ${pendingToolId}`, { pendingParams });
  const taskId = `confirm_${Date.now()}`;
  const correlationId = crypto.randomUUID();

  try {
    const { initWorkflow, setWorkflowStatus, appendStepResult } = await import("../orchestrator/status.js");
    const { dispatchTool } = await import("../tools/dispatcher.js");

    initWorkflow(taskId, correlationId);
    setWorkflowStatus(taskId, "running");

    const result = await dispatchTool(pendingToolId, pendingParams);
    appendStepResult(taskId, { stepId: pendingToolId, status: "completed", output: result });
    setWorkflowStatus(taskId, "completed");

    let resultString = typeof result === "string" ? result : JSON.stringify(result);
    if (resultString.length > 500) resultString = resultString.slice(0, 500) + "...";
    return `✅ Executed ${pendingToolId} successfully!\nOutput: ${resultString}`;
  } catch (error) {
    log.error(`Confirmed tool execution failed: ${pendingToolId}`, error);
    try {
      const { setWorkflowStatus, appendStepResult } = await import("../orchestrator/status.js");
      appendStepResult(taskId, { stepId: pendingToolId, status: "failed", error: String(error) });
      setWorkflowStatus(taskId, "failed");
    } catch {}
    return formatErrorForUser(error);
  }
}

