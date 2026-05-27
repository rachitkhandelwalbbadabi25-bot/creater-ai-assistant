// -----------------------------------------------------------------------------
// src/graph/laptopAgent.ts — Fast deterministic commands + AI planning fallback
// -----------------------------------------------------------------------------

import type { GraphState } from "./state.js";
import { TOOL_REGISTRY, getToolById, requiresConfirmation } from "@config/tools.js";
import { env } from "@config/index.js";
import { addMessage } from "@memory/shortTerm.js";
import { createLogger } from "@utils/logger.js";
import { formatErrorForUser } from "@utils/errorHandler.js";
import { isToolResult } from "@tools/toolResult.js";
import { isDeterministicLaunchIntent, routeFastCommand } from "./commandRouter.js";
import { executeFastCommand } from "./appLauncher.js";
import { adjustVolume } from "./automationController.js";
import { planLaptopTask } from "./planner.js";
import { executePlannedTools } from "./toolExecutor.js";

const log = createLogger("graph/laptopAgent");

function buildAvailableTools(intent: string): string[] {
  return TOOL_REGISTRY
    .filter((t) => {
      if (intent === "system_control") return t.category === "system" || t.category === "browser";
      if (intent === "browser_action") return t.category === "browser" || t.category === "system";
      if (intent === "file_operation") return t.category === "filesystem";
      return true;
    })
    .map((t) => `${t.id}: ${t.description}`);
}

export async function laptopAgentNode(state: GraphState): Promise<GraphState> {
  const startedAt = Date.now();
  log.info(`LaptopAgent: intent=${state.intent}`);
  log.info("Received command", { command: state.currentInput });
  console.log("[TIMING] input received", { command: state.currentInput });

  try {
    const fastCommand = routeFastCommand(state.currentInput);
    if (fastCommand) {
      console.log("[FAST PATH]", { command: state.currentInput, kind: fastCommand.kind });
      console.log("[TIMING] intent parsed", { mode: "deterministic", kind: fastCommand.kind });
      const launchResult =
        fastCommand.kind === "volume"
          ? await adjustVolume(fastCommand.direction)
          : await executeFastCommand(fastCommand);
      const response = isToolResult(launchResult)
        ? launchResult.message
        : typeof launchResult === "string"
          ? launchResult
          : (launchResult as { message?: string }).message ?? "Task completed";

      addMessage("user", state.currentInput, state.channel, { intent: state.intent });
      addMessage("assistant", response, state.channel);
      console.log("[TIMING] tool executed", { mode: "deterministic", kind: fastCommand.kind });
      console.log("[TIMING] frontend updated", { mode: "deterministic" });
      return { ...state, response, currentStep: "done" };
    }

    if (isDeterministicLaunchIntent(state.currentInput)) {
      log.warn("Deterministic launch intent detected without fast command resolution; bypassing planner for safety", {
        input: state.currentInput,
      });
      console.log("[FAST PATH HIT]");
      console.log("[FAST COMMAND]", state.currentInput.toLowerCase().replace(/\s+/g, " ").trim());
      console.log("[LLM BYPASS]");
      return {
        ...state,
        response: "Unable to resolve deterministic command safely.",
        currentStep: "error",
      };
    }

    console.log("[TIMING] intent parsed", { mode: "planner", intent: state.intent });
    const availableTools = buildAvailableTools(state.intent);
    const plan = await planLaptopTask({
      input: state.currentInput,
      contextBlock: state.contextBlock,
      selectedModel: state.selectedModel,
      availableTools,
    });

    const plannedToolCalls = plan.tools
      .filter((tool) => tool && tool.id)
      .map((tool) => ({ id: tool.id, params: tool.params ?? {} }));

    if (plannedToolCalls.length > 0) {
      for (const call of plannedToolCalls) {
        if (call.id.startsWith("shell.")) {
          console.log("[SHELL EXECUTION BLOCKED]", "src/graph/laptopAgent.ts", call.id, call.params ?? {});
          throw new Error("SHELL TOOL SHOULD NEVER EXECUTE");
        }
        const toolDef = getToolById(call.id);
        if (!toolDef) {
          throw new Error(`No tool definition found for ${call.id}`);
        }

        if (requiresConfirmation(toolDef, env.SAFETY_MODE as "strict" | "moderate" | "permissive")) {
          return {
            ...state,
            requiresConfirmation: true,
            pendingConfirmation: {
              toolId: call.id,
              params: call.params,
              reason: `Tool "${toolDef.name}" requires your confirmation (${toolDef.permission} permission).`,
            },
            response: `🔒 ${toolDef.name} ke liye permission chahiye. Kya run karun?\n> \`${call.id}\` with params: ${JSON.stringify(call.params)}`,
            currentStep: "responding",
          };
        }
      }

      const executionResults = await executePlannedTools(plannedToolCalls);
      const deterministicReply = executionResults.map((entry) => entry.result.message).join("\n");

      addMessage("user", state.currentInput, state.channel, { intent: state.intent });
      addMessage("assistant", deterministicReply, state.channel);
      console.log("[TIMING] tool executed", { mode: "planner", count: executionResults.length });
      console.log("[TIMING] frontend updated", { mode: "planner" });
      return { ...state, response: deterministicReply, currentStep: "done" };
    }

    const directReply = plan.reply?.trim() || "Done.";
    addMessage("user", state.currentInput, state.channel, { intent: state.intent });
    addMessage("assistant", directReply, state.channel);
    console.log("[TIMING] frontend updated", { mode: "planner-no-tools" });
    return { ...state, response: directReply, currentStep: "done" };
  } catch (err) {
    log.error("LaptopAgent failed", err, { command: state.currentInput });
    const userMessage = formatErrorForUser(err);
    addMessage("assistant", userMessage, state.channel);
    console.log("[TIMING] frontend updated", { mode: "error" });
    return { ...state, response: userMessage, currentStep: "error" };
  } finally {
    console.log("[TIMING] tool executed", { elapsedMs: Date.now() - startedAt, agent: "laptop" });
  }
}
