// ════════════════════════════════════════════════════════════════════════════════
// src/graph/supervisor.ts — Main orchestrator: routes to agents, manages flow
// This is the entry point for processing any user message.
//
// RUNTIME FLOW (post-patch):
//   input
//   → RuntimeModeClassifier   ← FIRST GATE (inline, zero-cost)
//   → if "execution":
//       direct laptopAgent    ← SKIPS router / emotion / memory / LLM-router
//   → else:
//       conversational router flow (lazy-loaded)
// ════════════════════════════════════════════════════════════════════════════════

import { createInitialState, type GraphState } from "./state.js";
import { taskAgentNode } from "./taskAgent.js";
import { laptopAgentNode } from "./laptopAgent.js";
import { projectAgentNode } from "./projectAgent.js";
import { skillAgentNode } from "./skillAgent.js";
import { createLogger } from "@utils/logger.js";
import { formatErrorForUser } from "@utils/errorHandler.js";

// NOTE: routerNode is NOT imported at module load.
// It is lazy-loaded only for conversational runtime modes.

const log = createLogger("graph/supervisor");

// ─── RuntimeModeClassifier ────────────────────────────────────────────────────
/**
 * classifyRuntimeMode
 *
 * Lightweight, zero-latency classifier — pure keyword/pattern matching.
 * Runs BEFORE any LLM call, router, or emotion detector.
 *
 * Returns:
 *   "execution"      → direct laptopAgent route
 *   "conversational" → standard router + emotion + memory pipeline
 */

type RuntimeMode = "execution" | "conversational";

// Execution-intent trigger verbs
const EXECUTION_VERBS = new Set([
  "open", "launch", "start", "run", "execute",
  "close", "quit", "exit", "kill", "stop",
  "play", "pause", "resume", "mute", "unmute",
  "search", "find", "look up", "google",
  "go to", "navigate to", "browse to",
  "type", "click", "press", "scroll",
  "download", "install", "uninstall",
  "create", "delete", "move", "copy", "rename",
  "send", "forward", "reply",
  "screenshot", "record", "capture",
  "increase", "decrease", "set volume", "turn on", "turn off",
  "switch to", "minimize", "maximize", "restore",
  "read", "show", "display",
]);

// Well-known targets that always imply execution
const EXECUTION_TARGETS = new Set([
  "youtube", "chrome", "google chrome", "firefox", "edge", "microsoft edge",
  "notepad", "calculator", "calc", "paint", "mspaint",
  "vscode", "vs code", "visual studio code",
  "explorer", "file explorer", "task manager",
  "spotify", "vlc", "discord", "slack", "whatsapp", "telegram",
  "gmail", "outlook", "teams",
  "settings", "control panel",
  "terminal", "cmd", "powershell", "command prompt",
  "word", "excel", "powerpoint", "onenote",
  "photos", "camera",
]);

function classifyRuntimeMode(input: string): RuntimeMode {
  log.info("RUNTIME MODE CLASSIFIER ACTIVE");

  const normalized = input
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  log.info(`INPUT NORMALIZED: "${normalized}"`);

  // Check if input starts with an execution verb
  for (const verb of EXECUTION_VERBS) {
    if (normalized === verb || normalized.startsWith(`${verb} `)) {
      log.info(`RUNTIME MODE DETECTED: execution (verb="${verb}")`);
      return "execution";
    }
  }

  // Check if any execution target appears in the input
  for (const target of EXECUTION_TARGETS) {
    if (normalized.includes(target)) {
      log.info(`RUNTIME MODE DETECTED: execution (target="${target}")`);
      return "execution";
    }
  }

  log.info("RUNTIME MODE DETECTED: conversational");
  return "conversational";
}

// ─── Agent Registry (conversational agents only — no laptopAgent here) ────────
type AgentNode = (state: GraphState) => Promise<GraphState>;

const CONVERSATIONAL_AGENTS: Record<string, AgentNode> = {
  taskAgent: taskAgentNode,
  projectAgent: projectAgentNode,
  skillAgent: skillAgentNode,
};

// ─── Shared Internal Pipeline ─────────────────────────────────────────────────
/**
 * runPipeline
 *
 * Single unified pipeline used by BOTH processMessage() and
 * processMessageStreaming(). Contains the RuntimeModeClassifier gate.
 *
 * No logic is duplicated between the two public entry points.
 */
async function runPipeline(state: GraphState): Promise<GraphState> {
  log.info("ACTIVE RUNTIME PATH: runPipeline()");

  const runtimeMode = classifyRuntimeMode(state.currentInput);

  // ── EXECUTION BRANCH ────────────────────────────────────────────────────────
  if (runtimeMode === "execution") {
    log.info("EXECUTION MODE ACTIVE");
    log.info("DIRECT EXECUTION ROUTE ACTIVE");
    log.info("CONVERSATIONAL PIPELINE SKIPPED");
    log.info("ROUTED TO laptopAgent");

    // Set minimal execution state — no emotion, no LLM-router, no memory
    state = {
      ...state,
      intent: "system_control",
      intentConfidence: 1,
      targetAgent: "laptopAgent",
      // Keep selectedModel empty — laptopAgent will pick one if needed
      selectedModel: state.selectedModel || "",
      currentStep: "executing",
    };

    state = await laptopAgentNode(state);

    log.info("EXECUTION BYPASS CONFIRMED");
    return state;
  }

  // ── CONVERSATIONAL BRANCH ───────────────────────────────────────────────────
  log.info("Conversational mode — lazy-loading router");

  // Lazy-load routerNode only when we actually need it
  const { routerNode } = await import("./router.js");
  state = await routerNode(state);
  log.info(
    `Routed → agent=${state.targetAgent}, intent=${state.intent}, mood=${state.mood}`
  );

  // If router picked laptopAgent, honour that
  if (state.targetAgent === "laptopAgent") {
    state = await laptopAgentNode(state);
    return state;
  }

  const agentFn = CONVERSATIONAL_AGENTS[state.targetAgent];
  if (!agentFn) {
    log.warn(`Unknown agent "${state.targetAgent}" — falling back to taskAgent`);
    state = await taskAgentNode(state);
  } else {
    state = await agentFn(state);
  }

  return state;
}

// ─── Public Entry Points ──────────────────────────────────────────────────────

/**
 * processMessageStreaming
 *
 * Streaming variant — exposes an onToken callback for token-by-token output.
 * Delegates the full runtime pipeline to runPipeline().
 */
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
    log.info(`Processing (stream): "${input.slice(0, 80)}" [${channel}]`);

    state = await runPipeline(state);

    const runtimeMode = classifyRuntimeMode(input);
    if (runtimeMode === "execution" && onToken && state.response) {
      onToken(state.response);
    }

    // Confirmation gate
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

/**
 * processMessage
 *
 * Blocking variant — returns the final response string.
 * Delegates the full runtime pipeline to runPipeline().
 */
export async function processMessage(
  input: string,
  channel: GraphState["channel"] = "tui"
): Promise<string> {
  const startTime = Date.now();

  try {
    let state = createInitialState(input, channel);
    log.info(`Processing: "${input.slice(0, 80)}" [${channel}]`);

    state = await runPipeline(state);

    // Confirmation gate
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

/**
 * processConfirmation
 *
 * Process a confirmation response (user said yes/no to a tool execution).
 */
export async function processConfirmation(
  confirmed: boolean,
  pendingToolId: string,
  pendingParams: Record<string, unknown>
): Promise<string> {
  if (!confirmed) {
    return "👍 Theek hai, cancel kar diya. Kuch aur chahiye?";
  }

  // TODO: Execute the pending tool call
  log.info(`User confirmed tool: ${pendingToolId}`);
  return `✅ Running ${pendingToolId}... (tool execution coming soon)`;
}
