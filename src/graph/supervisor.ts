// ════════════════════════════════════════════════════════════════════════════════
// src/graph/supervisor.ts — Main orchestrator: routes to agents, manages flow
// This is the entry point for processing any user message.
// ════════════════════════════════════════════════════════════════════════════════

import { createInitialState, type GraphState } from "./state.js";
import { routerNode } from "./router.js";
import { taskAgentNode } from "./taskAgent.js";
import { emotionAgentNode } from "./emotionAgent.js";
import { laptopAgentNode } from "./laptopAgent.js";
import { projectAgentNode } from "./projectAgent.js";
import { skillAgentNode } from "./skillAgent.js";
import { createLogger } from "@utils/logger.js";
import { formatErrorForUser, CreaterError } from "@utils/errorHandler.js";

const log = createLogger("graph/supervisor");

// ─── Agent Registry ───────────────────────────────────────────────────────────────
type AgentNode = (state: GraphState) => Promise<GraphState>;

const AGENTS: Record<string, AgentNode> = {
  taskAgent: taskAgentNode,
  emotionAgent: emotionAgentNode,
  laptopAgent: laptopAgentNode,
  projectAgent: projectAgentNode,
  skillAgent: skillAgentNode,
};

// ─── Main Processing Pipeline ─────────────────────────────────────────────────────
/**
 * Process a user message through the full agent pipeline:
 *
 * 1. Router → classify intent, detect emotion, retrieve memory
 * 2. Agent → selected agent processes the request
 * 3. Response → final answer returned to user
 *
 * This is the SINGLE entry point for all user interactions
 * (TUI, Telegram, Web, Voice all call this).
 */
export async function processMessage(
  input: string,
  channel: GraphState["channel"] = "tui",
  onToken?: (token: string) => void
): Promise<string> {
  const startTime = Date.now();

  try {
    // ── Step 1: Initialize state ──────────────────────────────────────────────
    let state = createInitialState(input, channel);
    state.onToken = onToken;
    log.info(`Processing: "${input.slice(0, 80)}..." [${channel}]`);

    // ── Step 2: Route (classify intent + emotion + memory) ────────────────────
    state = await routerNode(state);
    log.info(`Routed → agent=${state.targetAgent}, intent=${state.intent}, mood=${state.mood}`);

    // ── Step 3: Execute selected agent ────────────────────────────────────────
    const agentFn = AGENTS[state.targetAgent];
    if (!agentFn) {
      log.warn(`Unknown agent "${state.targetAgent}" — falling back to taskAgent`);
      state = await taskAgentNode(state);
    } else {
      state = await agentFn(state);
    }

    // ── Step 4: Handle confirmation requests ──────────────────────────────────
    if (state.requiresConfirmation && state.pendingConfirmation) {
      log.info(`Awaiting user confirmation for: ${state.pendingConfirmation.toolId}`);
      return state.response; // Return the confirmation prompt
    }

    // ── Step 5: Return response ───────────────────────────────────────────────
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
