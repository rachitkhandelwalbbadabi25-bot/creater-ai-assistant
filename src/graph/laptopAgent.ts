// ════════════════════════════════════════════════════════════════════════════════
// src/graph/laptopAgent.ts — Handles system control, shell, browser, file operations
// ════════════════════════════════════════════════════════════════════════════════

import type { GraphState } from "./state.js";
import { chat, type ChatMessage } from "@llm/client.js";
import { SYSTEM_PROMPT, buildToolSelectionPrompt } from "@llm/prompts.js";
import { GenerationPresets } from "@config/models.js";
import { DEFAULT_NUM_CTX } from "@llm/constants.js";
import { getNumPredict } from "@llm/tokenBudget.js";
import { TOOL_REGISTRY, requiresConfirmation } from "@config/tools.js";
import { env } from "@config/index.js";
import { addMessage } from "@memory/shortTerm.js";
import { createLogger } from "@utils/logger.js";
import { formatErrorForUser } from "@utils/errorHandler.js";
import { openApp, openUrl, openFileOrPath, openUrlInBrowser } from "@tools/laptop/launcher.js";
import { IS_RUNTIME_DEBUG } from "@utils/perf.js";
import { IntentEnum } from "../runtime/semantic/semanticTypes.js";
import { extractQuery } from "../runtime/semantic/queryExtractor.js";
import { RuntimeCommand } from "../runtime/runtimeCommand.js";
import { verifyStreamClean } from "../validation/streamDiagnostics.js";
import { isScreenshotActionCommand } from "./commandRouter.js";

const log = createLogger("graph/laptopAgent");
const REGEX = {
  openAndSearch: /^open\s+(.+?)\s+and\s+search\s+(.+)$/i,
  searchOnProvider: /^search\s+(?:for\s+)?(.+?)\s+on\s+(google|youtube)$/i,
  globalBrowser: /\b(?:on|in|using)\s+(chrome|edge|firefox)\b/i,
  directOpenBrowser: /^open\s+(.+?)\s+(?:on|in|using)\s+(chrome|edge|firefox)$/i,
  youtubeSearch: /^search\s+(.+)\s+on\s+youtube$/i,
  playYouTube: /^play\s+(.+)\s+on\s+youtube$/i,
  youtubeDirect: /^youtube\s+(.+)$/i,
  openGoogle: /^open\s+(.+)\s+on\s+google$/i,
  googleDirect: /^google\s+(.+)$/i,
  searchGeneric: /^search\s+(.+)$/i,
};
interface DeterministicSearchRoute {
  browser?: "chrome" | "edge" | "firefox";
  provider: "google" | "youtube" | "github" | "amazon" | "wikipedia";
  query: string;
  url: string;
}

function buildSearchUrl(provider: "google" | "youtube" | "github" | "amazon" | "wikipedia", query: string): string {
  switch (provider) {
    case "youtube":
      return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    case "github":
      return `https://github.com/search?q=${encodeURIComponent(query)}`;
    case "amazon":
      return `https://www.amazon.in/s?k=${encodeURIComponent(query)}`;
    case "wikipedia":
      return `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(query)}`;
    default:
      return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  }
}

function parseDeterministicSearchCommand(input: string): DeterministicSearchRoute | null {
  const normalized = input.trim().toLowerCase();

  const openAndSearchMatch = REGEX.openAndSearch.exec(normalized);
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

  const searchOnProviderMatch = REGEX.searchOnProvider.exec(normalized);
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

const siteNames: Record<string, string> = {
  gmail: "Gmail",
  youtube: "YouTube",
  github: "GitHub",
  chatgpt: "ChatGPT",
  linkedin: "LinkedIn",
  twitter: "Twitter",
  x: "X",
};

const getSiteDisplayName = (site: string): string => {
  return siteNames[site.toLowerCase()] || (site.charAt(0).toUpperCase() + site.slice(1));
};

async function executeDeterministicSearch(state: GraphState): Promise<string | null> {
  let route = parseDeterministicSearchCommand(state.currentInput);
  if (!route && state.intent === IntentEnum.BROWSER_SEARCH) {
    // Fallback deterministic detection using provider detection and query cleaning
    const provider = detectSearchProvider(state.currentInput);
    const query = cleanSearchQuery(state.currentInput);
    if (query) {
      route = { provider, query, url: buildSearchUrl(provider as any, query) };
    }
  }

  if (!route) {
    return null;
  }

  const providerName = route.provider === "youtube" ? "YouTube" : "Google";
  let feedback = "";
  if (route.browser) {
    const browserName = route.browser.charAt(0).toUpperCase() + route.browser.slice(1);
    feedback = `Searching ${providerName} for "${route.query}" in ${browserName}...`;
  } else {
    feedback = `Searching ${providerName} for "${route.query}"...`;
  }

  // Stream feedback immediately
  state.onToken?.(feedback);

  // Debug logging for provider detection
  log.info("PROVIDER DETECTION", { command: state.currentInput, provider: route.provider, query: route.query });
  log.info("DETERMINISTIC SEARCH WORKFLOW DETECTED", {
    browser: route.browser ?? "default",
    provider: route.provider,
  });
  log.info("Semantic retrieval skipped", { query: route.query });
  log.info("EMBEDDING BYPASS ACTIVE", { query: route.query });
  log.info("SEARCH URL GENERATED", { url: route.url });
  log.info("EXECUTION SEARCH BYPASS ACTIVE");

  try {
    if (route.browser) {
      await openUrlInBrowser(route.browser, route.url);
    } else {
      await openUrl(route.url);
    }
    return feedback;
  } catch (err) {
    log.warn("Deterministic search failed, running fallback recovery...", { error: String(err) });
    try {
      const fallbackBaseUrl = route.provider === "youtube" ? "https://www.youtube.com" : "https://www.google.com";
      if (route.browser) {
        await openUrlInBrowser(route.browser, fallbackBaseUrl);
        await openUrlInBrowser(route.browser, route.url);
      } else {
        await openUrl(fallbackBaseUrl);
        await openUrl(route.url);
      }
      return `Primary search tool failed. Recovered using fallback: searching ${providerName} for "${route.query}"...`;
    } catch (fallbackErr) {
      const formattedError = formatErrorForUser(fallbackErr);
      state.onToken?.(formattedError);
      throw new Error(formattedError);
    }
  }
}

function normalizeDirectOpenTarget(input: string): string {
  return input
    .toLowerCase()
    // Strip polite prefixes
    .replace(/\b(please|kindly|can you|could you)\b/g, "")
    // Strip action verbs
    .replace(/\b(open|launch|start)\b/g, "")
    // Strip browser specifiers — must be removed BEFORE target extraction
    .replace(/\b(?:on|in|using)\s+(?:chrome|edge|firefox)\b/gi, "")
    .trim();
}

// New helper: Detect which search provider is intended based on keywords
function detectSearchProvider(command: string): "youtube" | "github" | "amazon" | "wikipedia" | "google" {
  const lower = command.toLowerCase();
  if (lower.includes("youtube") || lower.includes("on youtube") || lower.includes("in youtube")) {
    return "youtube";
  }
  if (lower.includes("github") || lower.includes("on github")) {
    return "github";
  }
  if (lower.includes("amazon") || lower.includes("on amazon")) {
    return "amazon";
  }
  if (lower.includes("wikipedia") || lower.includes("on wikipedia")) {
    return "wikipedia";
  }
  return "google";
}

// New helper: Clean the raw command into a search query string
function cleanSearchQuery(command: string): string {
  return command
    .replace(/^open\s+/i, "")
    .replace(/^search\s+/i, "")
    .replace(/\s+on youtube$/i, "")
    .replace(/\s+in youtube$/i, "")
    .replace(/\s+on github$/i, "")
    .replace(/\s+on amazon$/i, "")
    .replace(/\s+on wikipedia$/i, "")
    .replace(/\s+youtube$/i, "")
    .replace(/\s+github$/i, "")
    .replace(/\s+amazon$/i, "")
    .replace(/\s+wikipedia$/i, "")
    .trim();
}

export const directMappings: Record<string, string> = {
  gmail: "https://mail.google.com",
  youtube: "https://www.youtube.com",
  github: "https://github.com",
  chatgpt: "https://chat.openai.com",
  linkedin: "https://www.linkedin.com",
  twitter: "https://twitter.com",
  x: "https://twitter.com",
};

async function tryDirectLaunch(state: GraphState): Promise<string | null> {
  const deterministicSearchResult = await executeDeterministicSearch(state);
  if (deterministicSearchResult) {
    return deterministicSearchResult;
  }

  const normalized = state.currentInput.trim().toLowerCase();

  // TASK 2: normalizeDirectOpenTarget strips browser specifiers before target extraction
  const target = normalizeDirectOpenTarget(state.currentInput).split(/\s+/)[0] ?? "";

  if (IS_RUNTIME_DEBUG) {
    log.info("NORMALIZED TARGET", { normalized, target });
  }



  const appDisplayNames: Record<string, string> = {
    chrome: "Google Chrome",
    "google Chrome": "Google Chrome",
    edge: "Microsoft Edge",
    "microsoft edge": "Microsoft Edge",
    firefox: "Firefox",
    notepad: "Notepad",
    calculator: "Calculator",
    calc: "Calculator",
    paint: "Paint",
    mspaint: "Paint",
    vscode: "VS Code",
    "vs code": "VS Code",
    "visual studio code": "VS Code",
    explorer: "File Explorer",
    "file explorer": "File Explorer",
  };

  // TASK 4: Browser-specific opening
  // Detect browser from original input BEFORE URL resolution
  const browserMatch = REGEX.directOpenBrowser.exec(normalized);
  if (browserMatch) {
    const site = browserMatch[1].trim();
    const browser = browserMatch[2].toLowerCase();

    if (IS_RUNTIME_DEBUG) {
      log.info("BROWSER TARGET DETECTED", { site, browser });
    }

    // TASK 3: Check directMappings FIRST, fallback only if no mapping exists
    const mappedUrl = directMappings[site];
    const finalUrl = mappedUrl ? mappedUrl : `https://${site}`;

    if (IS_RUNTIME_DEBUG) {
      if (mappedUrl) {
        log.info("DIRECT MAPPING MATCHED", { target: site, mappedUrl: finalUrl });
      }
    }

    const siteName = getSiteDisplayName(site);
    const browserName = browser.charAt(0).toUpperCase() + browser.slice(1);
    const feedback = `Opening ${siteName} in ${browserName}...`;
    state.onToken?.(feedback);

    try {
      await openUrlInBrowser(browser, finalUrl);
      await verifyStreamClean();
      return feedback;
    } catch (err) {
      const formattedError = formatErrorForUser(err);
      state.onToken?.(formattedError);
      throw new Error(formattedError);
    }
  }

  // TASK 3: No browser — check directMappings FIRST, fallback only if no mapping
  const mappedUrl = directMappings[target];
  const finalUrl = mappedUrl ? mappedUrl : `https://${target}`;

  if (mappedUrl) {
    if (IS_RUNTIME_DEBUG) {
      log.info("DIRECT MAPPING MATCHED", { target, mappedUrl: finalUrl });
    }

    const siteName = getSiteDisplayName(target);
    const feedback = `Opening ${siteName}...`;
    state.onToken?.(feedback);

    try {
      await openUrl(finalUrl);
      await verifyStreamClean();
      return feedback;
    } catch (err) {
      const formattedError = formatErrorForUser(err);
      state.onToken?.(formattedError);
      throw new Error(formattedError);
    }
  }

  // Additional deterministic shortcuts
  if (target === "browser" || target === "web browser") {
    const feedback = "Opening Web Browser...";
    state.onToken?.(feedback);
    try {
      await openUrl("https://www.google.com");
      return feedback;
    } catch (err) {
      const formattedError = formatErrorForUser(err);
      state.onToken?.(formattedError);
      throw new Error(formattedError);
    }
  }

  if (target === "downloads" || target === "download") {
    const feedback = "Opening Downloads folder...";
    state.onToken?.(feedback);
    try {
      const targetPath = process.env.USERPROFILE ? `${process.env.USERPROFILE}\\Downloads` : "C:\\Users\\dell\\Downloads";
      await openFileOrPath(targetPath);
      return feedback;
    } catch (err) {
      const formattedError = formatErrorForUser(err);
      state.onToken?.(formattedError);
      throw new Error(formattedError);
    }
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
    const appName = appDisplayNames[target] || (target.charAt(0).toUpperCase() + target.slice(1));
    const feedback = `Opening ${appName}...`;
    state.onToken?.(feedback);
    try {
      await openApp(target);
      return feedback;
    } catch (err) {
      const formattedError = formatErrorForUser(err);
      state.onToken?.(formattedError);
      throw new Error(formattedError);
    }
  }

  return null;
}

export async function laptopAgentNode(state: GraphState): Promise<GraphState> {
  const startTimestamp = Date.now();
  log.info(`LaptopAgent: intent=${state.intent}`);
  log.info("Received command", { command: state.currentInput });

  // Execution bypass: if running in deterministic execution mode, skip LLM and perform direct actions
  if (state.currentStep === "executing") {
    try {
      log.info("EXECUTION BYPASS ACTIVE - deterministic mode");
      log.info("DETERMINISTIC EXECUTION STARTED");
      if (state.intent === IntentEnum.BROWSER_SEARCH) {
        log.info("EXECUTION SEARCH BYPASS ACTIVE");
      }

      if (state.intent === IntentEnum.CONVERSATION || state.intent === "chat") {
        const { dispatchTool } = await import("../tools/dispatcher.js");
        const chatResult = await dispatchTool(RuntimeCommand.CHAT, { input: state.currentInput }) as { success?: boolean; response?: string };
        const response = chatResult?.response?.trim() || "I'm here.";
        addMessage("assistant", response, state.channel);
        return { ...state, response, currentStep: "done" };
      }

      // Fast Command Check (Direct URLs, Reminders, YouTube, Apps)
      const { routeFastCommand } = await import("./commandRouter.js");
      const fastCommand = routeFastCommand(state.currentInput);
      if (fastCommand) {
        const { dispatchTool } = await import("../tools/dispatcher.js");
        log.info("LaptopAgent executing fast command", { fastCommand });

        if (fastCommand.kind === "open_url") {
          const feedback = `Opening ${fastCommand.url}...`;
          state.onToken?.(feedback);
          await openUrl(fastCommand.url);
          addMessage("assistant", feedback, state.channel);
          return { ...state, response: feedback, currentStep: "done" };
        }

        if (fastCommand.kind === "reminder") {
          let toolId = "reminder.create";
          let params: Record<string, unknown> = {
            title: fastCommand.title,
            timeInput: fastCommand.timeInput,
            channel: state.channel,
          };
          if (fastCommand.action === "list") {
            toolId = "reminder.list";
            params = { channel: state.channel };
          } else if (fastCommand.action === "query") {
            toolId = "reminder.query";
            params = { queryType: fastCommand.queryType || "latest", channel: state.channel };
          } else if (fastCommand.action === "cancel") {
            toolId = "reminder.cancel";
            params = { query: fastCommand.query || "", channel: state.channel };
          }

          const res = (await dispatchTool(toolId, params)) as { success?: boolean; message?: string; error?: string };
          const responseMsg = res.message || (res.success ? "Action completed." : `Failed: ${res.error}`);
          state.onToken?.(responseMsg);
          addMessage("assistant", responseMsg, state.channel);
          return { ...state, response: responseMsg, currentStep: "done" };
        }

        if (fastCommand.kind === "youtube") {
          const query = fastCommand.query;
          const action = fastCommand.action || "play";

          if (!query) {
            const feedback = "Opening YouTube...";
            state.onToken?.(feedback);
            await openUrl("https://www.youtube.com");
            addMessage("assistant", feedback, state.channel);
            return { ...state, response: feedback, currentStep: "done" };
          }

          try {
            const result = (await dispatchTool("computer.play_youtube", { query, action, selection: fastCommand.selection || "first" })) as string | { message?: string };
            const responseMsg = typeof result === "string" ? result : result.message || `Completed YouTube ${action} for "${query}".`;
            state.onToken?.(responseMsg);
            addMessage("assistant", responseMsg, state.channel);
            return { ...state, response: responseMsg, currentStep: "done" };
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : `Failed to ${action} video on YouTube.`;
            state.onToken?.(errorMsg);
            addMessage("assistant", errorMsg, state.channel);
            return { ...state, response: errorMsg, currentStep: "error" };
          }
        }

        if (fastCommand.kind === "open_path" || fastCommand.kind === "open_downloads") {
          let folderName = "folder";
          const targetPath = fastCommand.path;
          const lowerPath = targetPath.toLowerCase();
          if (lowerPath.includes("screenshots")) folderName = "Screenshots folder";
          else if (lowerPath.includes("documents")) folderName = "Documents folder";
          else if (lowerPath.includes("desktop")) folderName = "Desktop folder";
          else if (lowerPath.includes("pictures")) folderName = "Pictures folder";
          else if (lowerPath.includes("music")) folderName = "Music folder";
          else if (lowerPath.includes("videos") || lowerPath.includes("movies")) folderName = "Videos folder";
          else if (lowerPath.includes("downloads")) folderName = "Downloads folder";
          else folderName = targetPath;

          const feedback = `Opening ${folderName}...`;
          state.onToken?.(feedback);
          try {
            await openFileOrPath(targetPath);
            addMessage("assistant", feedback, state.channel);
            return { ...state, response: feedback, currentStep: "done" };
          } catch (err) {
            const errorMsg = formatErrorForUser(err);
            state.onToken?.(errorMsg);
            addMessage("assistant", errorMsg, state.channel);
            return { ...state, response: errorMsg, currentStep: "error" };
          }
        }

        if (fastCommand.kind === "open_app") {
          const appDisplayNames: Record<string, string> = {
            chrome: "Google Chrome",
            edge: "Microsoft Edge",
            firefox: "Firefox",
            notepad: "Notepad",
            calculator: "Calculator",
            calc: "Calculator",
            paint: "Paint",
            mspaint: "Paint",
            vscode: "VS Code",
            explorer: "File Explorer",
          };
          const appName = appDisplayNames[fastCommand.app.toLowerCase()] || (fastCommand.app.charAt(0).toUpperCase() + fastCommand.app.slice(1));
          const feedback = `Opening ${appName}...`;
          state.onToken?.(feedback);
          try {
            await openApp(fastCommand.app);
            addMessage("assistant", feedback, state.channel);
            return { ...state, response: feedback, currentStep: "done" };
          } catch (err) {
            const errorMsg = formatErrorForUser(err);
            state.onToken?.(errorMsg);
            addMessage("assistant", errorMsg, state.channel);
            return { ...state, response: errorMsg, currentStep: "error" };
          }
        }

        if (fastCommand.kind === "browser_home") {
          const feedback = "Opening Web Browser...";
          state.onToken?.(feedback);
          try {
            await openUrl("https://www.google.com");
            addMessage("assistant", feedback, state.channel);
            return { ...state, response: feedback, currentStep: "done" };
          } catch (err) {
            const errorMsg = formatErrorForUser(err);
            state.onToken?.(errorMsg);
            addMessage("assistant", errorMsg, state.channel);
            return { ...state, response: errorMsg, currentStep: "error" };
          }
        }

        if (fastCommand.kind === "close_app") {
          try {
            const res = (await dispatchTool("system.close_app", { app: fastCommand.app })) as { message?: string } | string;
            const responseMsg = typeof res === "string" ? res : res.message || `Closed ${fastCommand.app}.`;
            state.onToken?.(responseMsg);
            addMessage("assistant", responseMsg, state.channel);
            return { ...state, response: responseMsg, currentStep: "done" };
          } catch (err) {
            const errorMsg = formatErrorForUser(err);
            state.onToken?.(errorMsg);
            addMessage("assistant", errorMsg, state.channel);
            return { ...state, response: errorMsg, currentStep: "error" };
          }
        }

        if (fastCommand.kind === "volume") {
          try {
            const res = (await dispatchTool("system.volume", {
              direction: fastCommand.direction,
              value: fastCommand.value,
            })) as { message?: string } | string;
            const responseMsg = typeof res === "string" ? res : res.message || `Volume adjusted (${fastCommand.direction}).`;
            state.onToken?.(responseMsg);
            addMessage("assistant", responseMsg, state.channel);
            return { ...state, response: responseMsg, currentStep: "done" };
          } catch (err) {
            const errorMsg = formatErrorForUser(err);
            state.onToken?.(errorMsg);
            addMessage("assistant", errorMsg, state.channel);
            return { ...state, response: errorMsg, currentStep: "error" };
          }
        }

        if (fastCommand.kind === "screenshot") {
          try {
            const res = (await dispatchTool("system.screenshot", {})) as { message?: string; filePath?: string };
            const responseMsg = res.message || `Screenshot captured successfully.`;
            state.onToken?.(responseMsg);
            addMessage("assistant", responseMsg, state.channel);
            return { ...state, response: responseMsg, currentStep: "done" };
          } catch (err) {
            const errorMsg = formatErrorForUser(err);
            state.onToken?.(errorMsg);
            addMessage("assistant", errorMsg, state.channel);
            return { ...state, response: errorMsg, currentStep: "error" };
          }
        }

        if (fastCommand.kind === "active_window") {
          try {
            const res = (await dispatchTool("cua.active_window", {})) as any;
            const data = (res && res.data) ? res.data : (res || {});
            const title = data.title || "";
            const process = data.process || "";
            const openApps: string[] = Array.isArray(data.openApps) ? data.openApps : [];
            const bounds = data.bounds;

            const lines: string[] = ["🖥️ **Screen Inspection:**"];
            if (title) {
              const boundsText = bounds && bounds.width > 0 ? ` (${bounds.width}x${bounds.height} at x=${bounds.x}, y=${bounds.y})` : "";
              lines.push(`• **Active Window**: **${title}**${process ? ` (\`${process}\`)` : ""}${boundsText}`);
            } else if (process) {
              lines.push(`• **Active Window**: **${process}**`);
            } else if (openApps.length > 0) {
              lines.push(`• **Active Workspace**: Desktop (Interactive Session with ${openApps.length} open apps)`);
            } else {
              lines.push(`• **Active Workspace**: Desktop (Interactive Session)`);
            }

            if (openApps.length > 0) {
              lines.push(`• **Detected Open Applications**: ${openApps.slice(0, 8).map((a: string) => `\`${a}\``).join(", ")}`);
            }

            // Also capture screenshot for visual verification
            try {
              const ssRes = (await dispatchTool("system.screenshot", {})) as any;
              if (ssRes?.filePath) {
                const pathMod = await import("path");
                lines.push(`• **Visual Snapshot**: Captured \`${pathMod.basename(ssRes.filePath)}\``);
              }
            } catch { }

            const responseMsg = lines.join("\n");
            state.onToken?.(responseMsg);
            addMessage("assistant", responseMsg, state.channel);
            return { ...state, response: responseMsg, currentStep: "done" };
          } catch (err) {
            const errorMsg = formatErrorForUser(err);
            state.onToken?.(errorMsg);
            addMessage("assistant", errorMsg, state.channel);
            return { ...state, response: errorMsg, currentStep: "error" };
          }
        }

        if (fastCommand.kind === "cua_click") {
          try {
            const res = (await dispatchTool("cua.click", { x: fastCommand.x, y: fastCommand.y })) as any;
            const responseMsg = res?.success
              ? `🖱️ Mouse clicked successfully at (${fastCommand.x}, ${fastCommand.y}).`
              : `Failed to click: ${res?.error || "Unknown error"}`;
            state.onToken?.(responseMsg);
            addMessage("assistant", responseMsg, state.channel);
            return { ...state, response: responseMsg, currentStep: "done" };
          } catch (err) {
            const errorMsg = formatErrorForUser(err);
            state.onToken?.(errorMsg);
            addMessage("assistant", errorMsg, state.channel);
            return { ...state, response: errorMsg, currentStep: "error" };
          }
        }

        if (fastCommand.kind === "cua_type") {
          try {
            let focusMsg = "";
            if (fastCommand.targetApp) {
              const { focusDesktopWindow } = await import("../tools/laptop/desktopControl.js");
              const focusRes = await focusDesktopWindow(fastCommand.targetApp);
              if (focusRes.found) {
                focusMsg = `Focused **${focusRes.title || fastCommand.targetApp}** and `;
                await new Promise((r) => setTimeout(r, 250));
              }
            }
            const res = (await dispatchTool("cua.type", { text: fastCommand.text })) as any;
            const responseMsg = res?.success
              ? `⌨️ ${focusMsg}Typed "${fastCommand.text}" into the active desktop window.`
              : `Failed to type: ${res?.error || "Unknown error"}`;
            state.onToken?.(responseMsg);
            addMessage("assistant", responseMsg, state.channel);
            return { ...state, response: responseMsg, currentStep: "done" };
          } catch (err) {
            const errorMsg = formatErrorForUser(err);
            state.onToken?.(errorMsg);
            addMessage("assistant", errorMsg, state.channel);
            return { ...state, response: errorMsg, currentStep: "error" };
          }
        }

        if (fastCommand.kind === "mcp_list") {
          try {
            const res = (await dispatchTool("mcp.list_servers", {})) as any;
            const data = (res && res.data) ? res.data : (res || {});
            const servers = data?.servers?.map((s: any) => `• **${s.name}** (v${s.version}) - ${s.toolCount} tools: \`[${s.tools.join(', ')}]\``).join('\n') || "No registered servers";
            const responseMsg = `📦 **Registered MCP Servers (${data?.count || data?.servers?.length || 0})**:\n\n${servers}`;
            state.onToken?.(responseMsg);
            addMessage("assistant", responseMsg, state.channel);
            return { ...state, response: responseMsg, currentStep: "done" };
          } catch (err) {
            const errorMsg = formatErrorForUser(err);
            state.onToken?.(errorMsg);
            addMessage("assistant", errorMsg, state.channel);
            return { ...state, response: errorMsg, currentStep: "error" };
          }
        }

        if (fastCommand.kind === "memory_store") {
          try {
            const { storeFact, getFact } = await import("../memory/longTerm.js");
            storeFact(fastCommand.category, fastCommand.key, fastCommand.value, 1.0, "user_explicit");
            const stored = getFact(fastCommand.category, fastCommand.key);
            if (stored) {
              const responseMsg = `I've saved that to my long-term memory: ${fastCommand.key} = "${fastCommand.value}".`;
              state.onToken?.(responseMsg);
              addMessage("assistant", responseMsg, state.channel);
              return { ...state, response: responseMsg, currentStep: "done" };
            }
            throw new Error("Failed to verify SQLite fact persistence");
          } catch (err) {
            const errorMsg = "I couldn't save that to long-term memory.";
            state.onToken?.(errorMsg);
            addMessage("assistant", errorMsg, state.channel);
            return { ...state, response: errorMsg, currentStep: "error" };
          }
        }

        if (fastCommand.kind === "memory_list") {
          try {
            const { buildUserProfile } = await import("../memory/longTerm.js");
            const profile = buildUserProfile();
            const responseMsg = `Here is what I remember about you:\n\n${profile}`;
            state.onToken?.(responseMsg);
            addMessage("assistant", responseMsg, state.channel);
            return { ...state, response: responseMsg, currentStep: "done" };
          } catch (err) {
            const errorMsg = "I couldn't retrieve your memory profile.";
            state.onToken?.(errorMsg);
            addMessage("assistant", errorMsg, state.channel);
            return { ...state, response: errorMsg, currentStep: "error" };
          }
        }

        if (fastCommand.kind === "memory_query") {
          try {
            const { getAllFacts, searchFacts } = await import("../memory/longTerm.js");
            const rawTarget = fastCommand.query.toLowerCase().trim();
            // 1. Direct search by query text
            let matching = searchFacts(rawTarget);
            // 2. Tokenized search across all facts
            if (matching.length === 0) {
              const all = getAllFacts();
              const tokens = rawTarget
                .split(/\s+/)
                .filter((t) => t.length > 2 && !["what", "tell", "about", "your", "name", "meri", "mera", "favorite", "fav", "kya", "hai"].includes(t));

              matching = all.filter((f) => {
                const combined = `${f.key} ${f.value}`.toLowerCase();
                return tokens.length > 0 && tokens.every((token) => combined.includes(token));
              });

              if (matching.length === 0 && tokens.length > 0) {
                matching = all.filter((f) => {
                  const combined = `${f.key} ${f.value}`.toLowerCase();
                  return tokens.some((token) => combined.includes(token));
                });
              }
            }

            if (matching.length > 0) {
              const fact = matching[0];
              const responseMsg = `According to my memory: ${fact.value}.`;
              state.onToken?.(responseMsg);
              addMessage("assistant", responseMsg, state.channel);
              return { ...state, response: responseMsg, currentStep: "done" };
            } else {
              const responseMsg = `I checked my memory, but I couldn't find any saved facts matching "${fastCommand.query}".`;
              state.onToken?.(responseMsg);
              addMessage("assistant", responseMsg, state.channel);
              return { ...state, response: responseMsg, currentStep: "done" };
            }
          } catch (err) {
            const errorMsg = "I couldn't retrieve that from memory.";
            state.onToken?.(errorMsg);
            addMessage("assistant", errorMsg, state.channel);
            return { ...state, response: errorMsg, currentStep: "error" };
          }
        }

        if (fastCommand.kind === "social_message" || (fastCommand as any).kind === "browser_act") {
          try {
            const goal =
              fastCommand.kind === "social_message"
                ? `Send message to ${fastCommand.recipient} on ${fastCommand.platform}: ${fastCommand.message}`
                : (fastCommand as any).goal || fastCommand.raw;

            state.onToken?.(`🌐 Launching Universal Web Operator for goal: "${goal}"...\n`);
            const res = (await dispatchTool("browser.autonomous_act", {
              goal,
            })) as any;

            const responseMsg = res?.summary || res?.details || `Processed autonomous action for "${goal}".`;
            state.onToken?.(responseMsg);
            addMessage("assistant", responseMsg, state.channel);
            return { ...state, response: responseMsg, currentStep: "done" };
          } catch (err) {
            const errorMsg = formatErrorForUser(err);
            state.onToken?.(errorMsg);
            addMessage("assistant", errorMsg, state.channel);
            return { ...state, response: errorMsg, currentStep: "error" };
          }
        }
      }

      const executionResults: Array<{ tool: string; result: unknown }> = [];
      const directResponse = await tryDirectLaunch(state);

      if (directResponse) {
        log.info("DIRECT LAUNCH EXECUTED");
        log.info("TOOL EXECUTION COMPLETE", { tool: "directLaunch", result: directResponse });
        if (IS_RUNTIME_DEBUG) {
          log.info("EXECUTION COMPLETED", {
            intent: state.intent,
            source: state.executionSource,
            executionMs: Date.now() - startTimestamp,
          });
        }
        addMessage("assistant", directResponse, state.channel);
        return { ...state, response: directResponse, currentStep: "done" };
      }

      if (state.intent === IntentEnum.BROWSER_SEARCH) {
        const extraction = extractQuery(state.currentInput);
        const query = extraction?.query?.trim();
        if (query) {
          const { dispatchTool } = await import("../tools/dispatcher.js");
          try {
            const searchResult = await dispatchTool(RuntimeCommand.WEB_SEARCH, { query }) as { success?: boolean; response?: string };
            if (searchResult && searchResult.success !== false) {
              const response = searchResult.response?.trim() || `Searching Google for "${query}"...`;
              addMessage("assistant", response, state.channel);
              return { ...state, response, currentStep: "done" };
            }
            throw new Error(searchResult?.response || "Search tool returned failure");
          } catch (err) {
            log.warn("WEB_SEARCH dispatch failed, running fallback recovery...", { error: String(err) });
            try {
              const fallbackUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
              await openUrl("https://www.google.com");
              await openUrl(fallbackUrl);
              const recoveryMsg = `Primary search tool failed. Recovered using fallback: searching Google for "${query}"...`;
              addMessage("assistant", recoveryMsg, state.channel);
              return { ...state, response: recoveryMsg, currentStep: "done" };
            } catch (fallbackErr) {
              const formattedError = `Failed to execute search. ${formatErrorForUser(fallbackErr)}`;
              addMessage("assistant", formattedError, state.channel);
              return { ...state, response: formattedError, currentStep: "error" };
            }
          }
        }

        const invalidSearchMessage = "I couldn't extract a valid search query from that request.";
        addMessage("assistant", invalidSearchMessage, state.channel);
        return { ...state, response: invalidSearchMessage, currentStep: "error" };
      }

      const normalized = state.currentInput.toLowerCase();
      const globalBrowserMatchResolver = REGEX.globalBrowser.exec(normalized);
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
      } else if (isScreenshotActionCommand(state.currentInput)) {
        toolsToExecute.push({ id: "system.screenshot", params: {} });
      }

      if (toolsToExecute.length > 0) {
        const { dispatchTool } = await import("../tools/dispatcher.js");
        let lastFeedback = "";
        for (const toolCall of toolsToExecute) {
          log.info("Executing tool", { id: toolCall.id, params: toolCall.params });

          let feedback = "Executing action...";
          if (toolCall.id === "system.open_path") {
            feedback = "Opening Downloads folder...";
          } else if (toolCall.id === "browser.navigate") {
            const url = (toolCall.params.url as string) || "";
            const siteName = url.includes("gmail") ? "Gmail" : url.includes("youtube") ? "YouTube" : "Website";
            const browserName = toolCall.params.browser ? (toolCall.params.browser as string).charAt(0).toUpperCase() + (toolCall.params.browser as string).slice(1) : "";
            feedback = browserName ? `Opening ${siteName} in ${browserName}...` : `Opening ${siteName}...`;
          } else if (toolCall.id === "system.open_app") {
            const app = (toolCall.params.app as string) || "";
            const appName = app.toLowerCase() === "chrome" ? "Google Chrome" : app.toLowerCase() === "notepad" ? "Notepad" : app.toLowerCase() === "calculator" ? "Calculator" : app.charAt(0).toUpperCase() + app.slice(1);
            feedback = `Opening ${appName}...`;
          } else if (toolCall.id === "system.screenshot") {
            feedback = "Screenshot captured successfully.";
          }

          lastFeedback = feedback;
          state.onToken?.(feedback);

          try {
            const result = await dispatchTool(toolCall.id, toolCall.params);
            executionResults.push({ tool: toolCall.id, result });
            log.info("TOOL EXECUTION COMPLETE", { tool: toolCall.id, result });
          } catch (err) {
            const formattedError = formatErrorForUser(err);
            state.onToken?.(formattedError);
            throw new Error(formattedError);
          }
        }
        log.info("DIRECT LAUNCH EXECUTED");
        const successMsg = lastFeedback || "Task completed";
        if (IS_RUNTIME_DEBUG) {
          log.info("EXECUTION COMPLETED", {
            intent: state.intent,
            source: state.executionSource,
            executionMs: Date.now() - startTimestamp,
          });
        }
        addMessage("assistant", successMsg, state.channel);
        return { ...state, response: successMsg, currentStep: "done" };
      }

      const fallbackMsg = "I couldn't determine a concrete action to execute.";
      log.info("DIRECT LAUNCH EXECUTED");
      log.info("TOOL EXECUTION COMPLETE", { tool: "fallback", result: fallbackMsg });
      if (IS_RUNTIME_DEBUG) {
        log.info("EXECUTION COMPLETED", {
          intent: state.intent,
          source: state.executionSource,
          executionMs: Date.now() - startTimestamp,
        });
      }
      addMessage("assistant", fallbackMsg, state.channel);
      return { ...state, response: fallbackMsg, currentStep: "done" };
    } catch (err) {
      if (IS_RUNTIME_DEBUG) {
        log.info("EXECUTION FAILURE DETECTED", {
          intent: state.intent,
          source: state.executionSource,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
      const errMsg = formatErrorForUser(err);
      addMessage("assistant", errMsg, state.channel);
      return { ...state, response: errMsg, currentStep: "error" };
    }
  }

  // Get relevant tools for this intent
  const toolNames = TOOL_REGISTRY
    .filter(t => {
      if (state.intent === "system_control") return t.category === "system" || t.category === "browser";
      if (state.intent === "browser_action" || state.intent === IntentEnum.BROWSER_SEARCH) return t.category === "browser" || t.category === "system";
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
    options: { ...GenerationPresets.precise, num_ctx: DEFAULT_NUM_CTX, num_predict: getNumPredict(state.intent) },
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
          options: { ...GenerationPresets.conversational, num_ctx: DEFAULT_NUM_CTX, num_predict: getNumPredict(state.intent) },
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

  const { enforceActionExecutionGuard } = await import("../validation/actionExecutionGuard.js");
  const guardResult = enforceActionExecutionGuard(state.intent, executionResults, response);

  addMessage("user", state.currentInput, state.channel, { intent: state.intent });
  addMessage("assistant", guardResult.guardedResponse, state.channel);

  return {
    ...state,
    response: guardResult.guardedResponse,
    currentStep: guardResult.allowed ? "done" : "error",
  };
}
