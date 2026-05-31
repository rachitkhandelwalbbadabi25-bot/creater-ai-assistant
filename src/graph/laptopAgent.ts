// ════════════════════════════════════════════════════════════════════════════════
// src/graph/laptopAgent.ts — Handles system control, shell, browser, file operations
// ════════════════════════════════════════════════════════════════════════════════

import type { GraphState } from "./state.js";
import { chat, type ChatMessage } from "@llm/client.js";
import { SYSTEM_PROMPT, buildToolSelectionPrompt } from "@llm/prompts.js";
import { GenerationPresets } from "@config/models.js";
import { TOOL_REGISTRY, requiresConfirmation } from "@config/tools.js";
import { env } from "@config/index.js";
import { addMessage } from "@memory/shortTerm.js";
import { createLogger } from "@utils/logger.js";
import { formatErrorForUser } from "@utils/errorHandler.js";
import { openApp, openUrl } from "@tools/laptop/launcher.js";
import { parseExecutionPlan } from "../runtime/deterministicOrchestration/parser.js";
import { executeWorkflow } from "../runtime/deterministicOrchestration/orchestrator.js";

const log = createLogger("graph/laptopAgent");

function normalizeDirectOpenTarget(input: string): string {
  return input
    .toLowerCase()
    .replace(/\b(please|kindly|can you|could you)\b/g, "")
    .replace(/\b(open|launch|start)\b/g, "")
    .trim();
}

async function tryDirectLaunch(input: string): Promise<string | null> {
  const target = normalizeDirectOpenTarget(input);
  if (!target) return null;

  if (target === "browser" || target === "web browser") {
    console.log("[LAUNCH TRACE]", "src/graph/laptopAgent.ts", "tryDirectLaunch", "https://www.google.com");
    await openUrl("https://www.google.com");
    return "Task completed";
  }

  if (target === "youtube" || target === "you tube") {
    console.log("[LAUNCH TRACE]", "src/graph/laptopAgent.ts", "tryDirectLaunch", "https://www.youtube.com");
    await openUrl("https://www.youtube.com");
    return "Task completed";
  }

  const appTargets = new Set([
    "chrome",
    "google chrome",
    "edge",
    "microsoft edge",
    "firefox",
    "notepad",
    "calculator",
    "calc",
    "paint",
    "mspaint",
    "vscode",
    "vs code",
    "visual studio code",
    "explorer",
    "file explorer",
  ]);

  if (appTargets.has(target)) {
    console.log("[LAUNCH TRACE]", "src/graph/laptopAgent.ts", "tryDirectLaunch", target);
    await openApp(target);
    return "Task completed";
  }

  return null;
}

export async function laptopAgentNode(state: GraphState): Promise<GraphState> {
  log.info(`LaptopAgent: intent=${state.intent}`);
  log.info("Received command", { command: state.currentInput });

  // ── 1. DETERMINISTIC EXECUTION ISOLATION ──
  if (state.currentStep === "executing") {
    console.log("DETERMINISTIC EXECUTION PATH ACTIVE");
    console.log("QWEN EXECUTION BYPASS CONFIRMED");
    log.info("DETERMINISTIC EXECUTION PATH ACTIVE");
    log.info("QWEN EXECUTION BYPASS CONFIRMED");

    try {
      const plan = parseExecutionPlan(state.currentInput);
      console.log("EXECUTION PLAN GENERATED");
      log.info("EXECUTION PLAN GENERATED", { plan });

      console.log("EXECUTION WORKFLOW START");
      log.info("EXECUTION WORKFLOW START");
      
      const execState = await executeWorkflow(plan);
      
      console.log("EXECUTION WORKFLOW COMPLETE");
      log.info("EXECUTION WORKFLOW COMPLETE", { status: execState.status });
      
      // Check if native Chrome was launched
      if (execState.browserState?.isLaunched) {
        console.log("NATIVE BROWSER LAUNCH ACTIVE");
        log.info("NATIVE BROWSER LAUNCH ACTIVE");
      }

      if (execState.status === "error") {
        const errResponse = `Execution failed: ${execState.failedStep?.error || "Unknown error"}`;
        addMessage("assistant", errResponse, state.channel);
        return { ...state, response: errResponse, currentStep: "error" };
      }
      
      const successResponse = "Task completed";
      addMessage("assistant", successResponse, state.channel);
      return { ...state, response: successResponse, currentStep: "done" };
    } catch (err) {
      log.error("Execution workflow failed", err);
      const userMessage = formatErrorForUser(err);
      addMessage("assistant", userMessage, state.channel);
      return { ...state, response: userMessage, currentStep: "error" };
    }
  }

  // ── 2. CONVERSATIONAL TOOL PARSING (Only for non-execution modes) ──
  try {
    const directLaunchResponse = await tryDirectLaunch(state.currentInput);
    if (directLaunchResponse) {
      addMessage("assistant", directLaunchResponse, state.channel);
      return { ...state, response: directLaunchResponse, currentStep: "done" };
    }
  } catch (err) {
    log.error("Direct launch failed", err, { command: state.currentInput });
    const userMessage = formatErrorForUser(err);
    addMessage("assistant", userMessage, state.channel);
    return { ...state, response: userMessage, currentStep: "error" };
  }

  // Get relevant tools for this intent
  const toolNames = TOOL_REGISTRY
    .filter(t => {
      if (state.intent === "system_control") return t.category === "system" || t.category === "browser";
      if (state.intent === "browser_action") return t.category === "browser" || t.category === "system";
      if (state.intent === "file_operation") return t.category === "filesystem";
      return true;
    })
    .map(t => `${t.id}: ${t.description}`);

  // Ask LLM to select tools and generate response
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `${SYSTEM_PROMPT}\n\n${buildToolSelectionPrompt(toolNames)}\n\n${state.contextBlock}`,
    },
    { role: "user", content: state.currentInput },
  ];

  const response = await chat({
    model: state.selectedModel,
    messages,
    options: GenerationPresets.precise,
  });

  // Check for tool calls and execute if safe
  let executionResults: any[] = [];
  try {
    let parsed: any = { tools: [], reasoning: "" };
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          // Try to extract tools array manually if JSON is malformed
          const toolsMatch = response.match(/"tools"\s*:\s*(\[[\s\S]*?\])/);
          const reasoningMatch = response.match(/"reasoning"\s*:\s*"([^"]*)"/);
          if (toolsMatch) {
            try {
              parsed.tools = JSON.parse(toolsMatch[1]);
            } catch {
              parsed.tools = [];
            }
          }
          if (reasoningMatch) {
            parsed.reasoning = reasoningMatch[1];
          }
        }
      }
    } catch {
      parsed = { tools: [], reasoning: "" };
    }

    if (parsed.tools) {
      parsed.tools = parsed.tools.filter(
        (t: any) => t && typeof t === 'object' && t.id
      );
    }
    
    log.info("Parsed tools:", { tools: parsed.tools });
    
    if (parsed.tools?.length > 0) {
      for (const toolCall of parsed.tools) {
        log.info("Executing tool", { id: toolCall.id, params: toolCall.params });
        const toolDef = TOOL_REGISTRY.find(t => t.id === toolCall.id);
        if (!toolDef) {
          throw new Error(`No tool definition found for ${toolCall.id}`);
        }

        // Safety Check
        const needsConfirm = requiresConfirmation(toolDef, env.SAFETY_MODE as "strict" | "moderate" | "permissive");
        
        if (needsConfirm) {
          return {
            ...state,
            requiresConfirmation: true,
            pendingConfirmation: {
              toolId: toolCall.id,
              params: toolCall.params,
              reason: `Tool "${toolDef.name}" requires your confirmation (${toolDef.permission} permission).`,
            },
            response: `🔒 ${toolDef.name} ke liye permission chahiye. Kya run karun?\n> \`${toolCall.id}\` with params: ${JSON.stringify(toolCall.params)}`,
            currentStep: "responding",
          };
        }

        // Execute safe tools
        const result = await import("../tools/dispatcher.js").then(m => m.dispatchTool(toolCall.id, toolCall.params));
        executionResults.push({ tool: toolCall.id, result });
      }

      // If we executed tools, generate a new response based on results
      if (executionResults.length > 0) {
        const allLaunchesCompleted = executionResults.every((entry) => {
          const result = entry.result;
          return result && result.success === true && result.message === "Task completed";
        });

        if (allLaunchesCompleted) {
          addMessage("assistant", "Task completed", state.channel);
          return { ...state, response: "Task completed", currentStep: "done" };
        }

        const friendlyMessages: ChatMessage[] = [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: state.currentInput },
          { role: "assistant", content: `I executed these tools: ${JSON.stringify(executionResults)}` },
          { role: "user", content: "Now give a short friendly response in the same language the user used. Confirm success only for tools whose result shows success=true. Do not say Task completed unless the result message is exactly Task completed." }
        ];

        const friendlyResponse = await chat({
          model: state.selectedModel,
          messages: friendlyMessages,
          options: GenerationPresets.conversational,
        });

        addMessage("assistant", friendlyResponse, state.channel);
        return { ...state, response: friendlyResponse, currentStep: "done" };
      }
    }
  } catch (err) {
    log.error("Tool selection or execution failed", err, { command: state.currentInput });
    const userMessage = formatErrorForUser(err);
    addMessage("assistant", userMessage, state.channel);
    return { ...state, response: userMessage, currentStep: "error" };
  }

  addMessage("user", state.currentInput, state.channel, { intent: state.intent });
  addMessage("assistant", response, state.channel);

  return { ...state, response, currentStep: "done" };
}
