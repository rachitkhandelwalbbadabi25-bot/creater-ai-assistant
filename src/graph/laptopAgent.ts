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
    return "Browser opened successfully.";
  }

  if (target === "youtube" || target === "you tube") {
    console.log("[LAUNCH TRACE]", "src/graph/laptopAgent.ts", "tryDirectLaunch", "https://www.youtube.com");
    await openUrl("https://www.youtube.com");
    return "YouTube opened successfully.";
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
    const capitalizedTarget = target.charAt(0).toUpperCase() + target.slice(1);
    return `${capitalizedTarget} opened successfully.`;
  }

  return null;
}

export async function laptopAgentNode(state: GraphState): Promise<GraphState> {
  log.info(`LaptopAgent: intent=${state.intent}`);
  log.info("Received command", { command: state.currentInput });

  try {
    const directLaunchResponse = await tryDirectLaunch(state.currentInput);
    if (directLaunchResponse) {
      console.log("EXECUTION RESPONSE GENERATED");
      addMessage("assistant", directLaunchResponse, state.channel);
      console.log("EXECUTION RESPONSE SENT");
      return { ...state, response: directLaunchResponse, currentStep: "done" };
    }
  } catch (err) {
    log.error("Direct launch failed", err, { command: state.currentInput });
    const userMessage = formatErrorForUser(err);
    console.log("EXECUTION RESPONSE GENERATED");
    addMessage("assistant", userMessage, state.channel);
    console.log("EXECUTION RESPONSE SENT");
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

      // If we executed tools, generate deterministic response based on results
      if (executionResults.length > 0) {
        // Build deterministic messages per result
        const deterministicMessages: string[] = executionResults.map(entry => {
          const result = entry.result as any;
          if (!result || !result.success) {
            // Return error message if available
            return result?.message ?? "Execution failed.";
          }
          switch (result.kind) {
            case "screenshot":
              return "Screenshot captured successfully.";
            case "directory":
              return "Folder opened successfully.";
            case "file":
              return "File opened successfully.";
            case "url":
              return "URL opened successfully.";
            case "app":
              return `${result.matchedApp || "Application"} opened successfully.`;
            default:
              return result.message ?? "Task completed.";
          }
        });
        const finalResponse = deterministicMessages.join(" ");
        console.log("EXECUTION RESPONSE GENERATED");
        addMessage("assistant", finalResponse, state.channel);
        console.log("EXECUTION RESPONSE SENT");
        return { ...state, response: finalResponse, currentStep: "done" };
      }
    }
  } catch (err) {
    log.error("Tool selection or execution failed", err, { command: state.currentInput });
    const userMessage = formatErrorForUser(err);
    console.log("EXECUTION RESPONSE GENERATED");
    addMessage("assistant", userMessage, state.channel);
    console.log("EXECUTION RESPONSE SENT");
    return { ...state, response: userMessage, currentStep: "error" };
  }

  addMessage("user", state.currentInput, state.channel, { intent: state.intent });
  console.log("EXECUTION RESPONSE GENERATED");
  addMessage("assistant", response, state.channel);
  console.log("EXECUTION RESPONSE SENT");

  return { ...state, response, currentStep: "done" };
}
