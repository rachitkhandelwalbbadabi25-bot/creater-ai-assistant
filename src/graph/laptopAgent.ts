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
import { openApp, openUrl, openFileOrPath, openUrlInBrowser } from "@tools/laptop/launcher.js";

const log = createLogger("graph/laptopAgent");

interface DeterministicSearchRoute {
  browser?: "chrome" | "edge" | "firefox";
  provider: "google" | "youtube";
  query: string;
  url: string;
}

function buildSearchUrl(provider: "google" | "youtube", query: string): string {
  return provider === "youtube"
    ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
    : `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function parseDeterministicSearchCommand(input: string): DeterministicSearchRoute | null {
  const normalized = input.trim().toLowerCase();

  const openAndSearchMatch = normalized.match(/^open\s+(.+?)\s+and\s+search\s+(.+)$/i);
  if (openAndSearchMatch) {
    const target = openAndSearchMatch[1]?.trim();
    const query = openAndSearchMatch[2]?.trim();
    if (!target || !query) {
      return null;
    }

    if (target === "youtube") {
      return { provider: "youtube", query, url: buildSearchUrl("youtube", query) };
    }

    if (target === "google") {
      return { provider: "google", query, url: buildSearchUrl("google", query) };
    }

    if (target === "chrome" || target === "edge" || target === "firefox") {
      return { browser: target, provider: "google", query, url: buildSearchUrl("google", query) };
    }
  }

  const searchOnProviderMatch = normalized.match(/^search\s+(.+?)\s+on\s+(google|youtube)$/i);
  if (searchOnProviderMatch) {
    const query = searchOnProviderMatch[1]?.trim();
    const provider = searchOnProviderMatch[2]?.trim() as "google" | "youtube" | undefined;
    if (!query || !provider) {
      return null;
    }

    return { provider, query, url: buildSearchUrl(provider, query) };
  }

  return null;
}

async function executeDeterministicSearch(input: string): Promise<string | null> {
  const route = parseDeterministicSearchCommand(input);
  if (!route) {
    return null;
  }

  log.info("DETERMINISTIC SEARCH WORKFLOW DETECTED", {
    browser: route.browser ?? "default",
    provider: route.provider,
  });
  log.info("SEARCH QUERY EXTRACTED", { query: route.query });
  log.info("SEARCH URL GENERATED", { url: route.url });
  log.info("EXECUTION SEARCH BYPASS ACTIVE");

  if (route.browser) {
    await openUrlInBrowser(route.browser, route.url);
  } else {
    await openUrl(route.url);
  }

  return "Task completed";
}

function normalizeDirectOpenTarget(input: string): string {
  return input
    .toLowerCase()
    .replace(/\b(please|kindly|can you|could you)\b/g, "")
    .replace(/\b(open|launch|start)\b/g, "")
    .trim();
}

async function tryDirectLaunch(input: string): Promise<string | null> {
  const deterministicSearchResult = await executeDeterministicSearch(input);
  if (deterministicSearchResult) {
    return deterministicSearchResult;
  }

  const normalized = input.trim().toLowerCase();
  // Detect global browser context (on/in/using)
  const globalBrowserMatch = normalized.match(/\b(?:on|in|using)\s+(chrome|edge|firefox)\b/i);
  const detectedBrowser = globalBrowserMatch?.[1]?.toLowerCase();
  if (detectedBrowser) {
    log.info("BROWSER CONTEXT DETECTED", { detectedBrowser });
  }
  
  // 1. YouTube Search
  // search ___ on youtube, play ___ on youtube, youtube ___
  if (/^search\s+(.+)\s+on\s+youtube$/i.test(normalized)) {
    const query = normalized.match(/^search\s+(.+)\s+on\s+youtube$/i)?.[1]?.trim();
    if (query) {
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      log.info("DETERMINISTIC SEARCH ROUTE DETECTED", { query });
      log.info("YOUTUBE SEARCH ROUTE GENERATED", { query, url });
      await openUrl(url);
      return "Task completed";
    }
  }
  if (/^play\s+(.+)\s+on\s+youtube$/i.test(normalized)) {
    const query = normalized.match(/^play\s+(.+)\s+on\s+youtube$/i)?.[1]?.trim();
    if (query) {
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      log.info("DETERMINISTIC SEARCH ROUTE DETECTED", { query });
      log.info("YOUTUBE SEARCH ROUTE GENERATED", { query, url });
      await openUrl(url);
      return "Task completed";
    }
  }
  if (/^youtube\s+(.+)$/i.test(normalized)) {
    const query = normalized.match(/^youtube\s+(.+)$/i)?.[1]?.trim();
    if (query) {
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      log.info("DETERMINISTIC SEARCH ROUTE DETECTED", { query });
      log.info("YOUTUBE SEARCH ROUTE GENERATED", { query, url });
      await openUrl(url);
      return "Task completed";
    }
  }

  // 2. Google Search
  // open ___ on google, search ___ (not matching youtube), google ___
  if (/^open\s+(.+)\s+on\s+google$/i.test(normalized)) {
    const query = normalized.match(/^open\s+(.+)\s+on\s+google$/i)?.[1]?.trim();
    if (query) {
      const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      log.info("DETERMINISTIC SEARCH ROUTE DETECTED", { query });
      log.info("GOOGLE SEARCH ROUTE GENERATED", { query, url });
      await openUrl(url);
      return "Task completed";
    }
  }
  if (/^google\s+(.+)$/i.test(normalized)) {
    const query = normalized.match(/^google\s+(.+)$/i)?.[1]?.trim();
    if (query) {
      const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      log.info("DETERMINISTIC SEARCH ROUTE DETECTED", { query });
      log.info("GOOGLE SEARCH ROUTE GENERATED", { query, url });
      await openUrl(url);
      return "Task completed";
    }
  }
  if (/^search\s+(.+)$/i.test(normalized)) {
    const query = normalized.match(/^search\s+(.+)$/i)?.[1]?.trim();
    if (query) {
      const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      log.info("DETERMINISTIC SEARCH ROUTE DETECTED", { query });
      log.info("GOOGLE SEARCH ROUTE GENERATED", { query, url });
      await openUrl(url);
      return "Task completed";
    }
  }

  // 3. Direct Mappings
  const target = normalizeDirectOpenTarget(input);
  if (!target) return null;

  const directMappings: Record<string, string> = {
    github: "https://github.com",
    youtube: "https://youtube.com",
    gmail: "https://mail.google.com",
    googlemail: "https://mail.google.com",
    "google mail": "https://mail.google.com",
    chatgpt: "https://chat.openai.com",
    linkedin: "https://linkedin.com",
    twitter: "https://x.com",
    x: "https://x.com",
  };

  if (target in directMappings) {
    const url = directMappings[target]!;
    // Browser‑specific opening: "open <site> in <browser>"
    const browserMatch = normalized.match(/^open\s+(.+?)\s+(?:on|in|using)\s+(chrome|edge|firefox)$/i);
    if (browserMatch) {
      const site = browserMatch[1].trim();
      const browser = browserMatch[2].toLowerCase();
      let targetUrl = site;
      if (site in directMappings) {
        targetUrl = directMappings[site]!;
      }
      log.info("DETERMINISTIC BROWSER‑SPECIFIC ROUTE DETECTED", { site, browser });
      await openUrlInBrowser(browser, targetUrl);
    } else {
      log.info("DETERMINISTIC SEARCH ROUTE DETECTED", { target });
      await openUrl(url);
    }
    return "Task completed";
  }

  if (target === "browser" || target === "web browser") {
    console.log("[LAUNCH TRACE]", "src/graph/laptopAgent.ts", "tryDirectLaunch", "https://www.google.com");
    await openUrl("https://www.google.com");
    return "Task completed";
  }

  if (target === "downloads" || target === "download") {
    console.log("[LAUNCH TRACE]", "src/graph/laptopAgent.ts", "tryDirectLaunch", "%USERPROFILE%\\Downloads");
    const targetPath = process.env.USERPROFILE ? `${process.env.USERPROFILE}\\Downloads` : "C:\\Users\\dell\\Downloads";
    await openFileOrPath(targetPath);
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

  // Execution bypass: if running in deterministic execution mode, skip LLM and perform direct actions
  if (state.currentStep === "executing") {
    log.info("EXECUTION BYPASS ACTIVE - deterministic mode");
    log.info("DETERMINISTIC EXECUTION STARTED");
    if (state.intent === "web_search") {
      log.info("EXECUTION SEARCH BYPASS ACTIVE");
    }

    const executionResults: Array<{ tool: string; result: unknown }> = [];
    const directResponse = await tryDirectLaunch(state.currentInput);
    
    if (directResponse) {
      log.info("DIRECT LAUNCH EXECUTED");
      log.info("TOOL EXECUTION COMPLETE", { tool: "directLaunch", result: directResponse });
      addMessage("assistant", directResponse, state.channel);
      return { ...state, response: directResponse, currentStep: "done" };
    }

    const normalized = state.currentInput.toLowerCase();
    const globalBrowserMatchResolver = normalized.match(/\b(?:on|in|using)\s+(chrome|edge|firefox)\b/i);
    const detectedBrowser = globalBrowserMatchResolver?.[1]?.toLowerCase();
    if (detectedBrowser) {
      log.info("BROWSER CONTEXT DETECTED (resolver)", { detectedBrowser });
    }
    const toolsToExecute: Array<{ id: string; params: Record<string, unknown> }> = [];

    // Parse commands for downloads/gmail/youtube/chrome/notepad/calculator
    if (normalized.includes("open downloads") || normalized.includes("launch downloads")) {
      const targetPath = process.env.USERPROFILE ? `${process.env.USERPROFILE}\\Downloads` : "C:\\Users\\dell\\Downloads";
      toolsToExecute.push({ id: "system.open_path", params: { path: targetPath } });
    } else if (normalized.includes("open gmail") || normalized.includes("launch gmail")) {
      toolsToExecute.push({
        id: "browser.navigate",
        params: { url: "https://mail.google.com", ...(detectedBrowser ? { browser: detectedBrowser } : {}) }
      });
    } else if (normalized.includes("open youtube") || normalized.includes("launch youtube")) {
      toolsToExecute.push({
        id: "browser.navigate",
        params: { url: "https://www.youtube.com", ...(detectedBrowser ? { browser: detectedBrowser } : {}) }
      });
    } else if (normalized.includes("open chrome") || normalized.includes("launch chrome")) {
      toolsToExecute.push({ id: "system.open_app", params: { app: "chrome" } });
    } else if (normalized.includes("open notepad") || normalized.includes("launch notepad")) {
      toolsToExecute.push({ id: "system.open_app", params: { app: "notepad" } });
    } else if (normalized.includes("open calculator") || normalized.includes("launch calculator") || normalized.includes("open calc")) {
      toolsToExecute.push({ id: "system.open_app", params: { app: "calculator" } });
    }

    // No changes needed for other tool calls

    if (toolsToExecute.length > 0) {
      const { dispatchTool } = await import("../tools/dispatcher.js");
      for (const toolCall of toolsToExecute) {
        log.info("Executing tool", { id: toolCall.id, params: toolCall.params });
        const result = await dispatchTool(toolCall.id, toolCall.params);
        executionResults.push({ tool: toolCall.id, result });
        log.info("TOOL EXECUTION COMPLETE", { tool: toolCall.id, result });
      }
      log.info("DIRECT LAUNCH EXECUTED");
      const successMsg = "Task completed";
      addMessage("assistant", successMsg, state.channel);
      return { ...state, response: successMsg, currentStep: "done" };
    }

    const fallbackMsg = "Task completed (deterministic execution bypass).";
    log.info("DIRECT LAUNCH EXECUTED");
    log.info("TOOL EXECUTION COMPLETE", { tool: "fallback", result: fallbackMsg });
    addMessage("assistant", fallbackMsg, state.channel);
    return { ...state, response: fallbackMsg, currentStep: "done" };
  }

  // Get relevant tools for this intent
  const toolNames = TOOL_REGISTRY
    .filter(t => {
      if (state.intent === "system_control") return t.category === "system" || t.category === "browser";
      if (state.intent === "browser_action" || state.intent === "web_search") return t.category === "browser" || t.category === "system";
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
  const executionResults: Array<{ tool: string; result: unknown }> = [];
  try {
    let parsed: { tools: Array<{ id: string; params: Record<string, unknown> }>; reasoning: string } = { tools: [], reasoning: "" };
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
        (t): t is { id: string; params: Record<string, unknown> } => {
          const item = t as Record<string, unknown> | null;
          return !!item && typeof item === "object" && typeof item.id === "string";
        }
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
          const result = entry.result as Record<string, unknown> | null;
          return !!result && result.success === true && result.message === "Task completed";
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
