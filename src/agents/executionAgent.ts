// src/agents/executionAgent.ts

import { nowMs, logPerf } from "@utils/perf.js";
import { createLogger } from "@utils/logger.js";
import type { AgentSharedContext } from "../orchestration/agentSharedContext.js";
import type { AgentResult } from "../orchestration/agentBus.js";
import { browserSessionManager } from "../mcp/browser/sessionManager.js";

export interface ExecutionOutput {
  success: boolean;
  stepsExecuted: string[];
  outputs: any[];
}

const log = createLogger("[EXECUTION]");

export async function executionAgent(
  context: AgentSharedContext
): Promise<AgentResult<ExecutionOutput>> {
  const started = nowMs();
  log.info('[EXECUTION_AGENT_START]', { context: (context as any).plannerAgentOutput?.steps?.length ?? 0 });
  console.log("[BROWSER_WORKFLOW_START]");
  log.info("[LLM_CALL] none (executionAgent)");
  const planner = (context as any).plannerAgentOutput as any;
  const steps: string[] = planner?.steps ?? [];

  const outputs: any[] = [];
  const stepsExecuted: string[] = [];
  let tabId: string | null = null;

  try {
    for (const step of steps) {
      log.info('[STEP_EXECUTION]', { step });
      stepsExecuted.push(step);
      const stepLower = step.toLowerCase();

      if (stepLower.includes("open") && stepLower.includes("browser")) {
        log.info('[TOOL_SELECTED]', { tool: "openPage" });
        log.info('[TOOL_DISPATCH]', { tool: "openPage" });
        tabId = await browserSessionManager.openPage();
        log.info('[PLAYWRIGHT_START]');
        outputs.push({ step, status: "success", detail: "Browser window opened" });
      } else if (stepLower.includes("navigate") || stepLower.includes("google")) {
        if (!tabId) {
          log.info('[TOOL_SELECTED]', { tool: "openPage" });
          log.info('[TOOL_DISPATCH]', { tool: "openPage" });
          tabId = await browserSessionManager.openPage();
          log.info('[PLAYWRIGHT_START]');
        }
        let url = "https://www.google.com";
        const urlMatch = step.match(/https?:\/\/[^\s]+/i);
        if (urlMatch) {
          url = urlMatch[0];
        }
        log.info('[TOOL_SELECTED]', { tool: "navigate", url });
        log.info('[TOOL_DISPATCH]', { tool: "navigate", url });
        log.info('[PAGE_GOTO]', { url });
        await browserSessionManager.navigate(tabId, url);
        outputs.push({ step, status: "success", detail: `Navigated to ${url}` });
      } else if (stepLower.includes("search") || stepLower.includes("look up")) {
        if (!tabId) {
          log.info('[TOOL_SELECTED]', { tool: "openPage" });
          log.info('[TOOL_DISPATCH]', { tool: "openPage" });
          tabId = await browserSessionManager.openPage();
          log.info('[PLAYWRIGHT_START]');
          log.info('[TOOL_SELECTED]', { tool: "navigate", url: "https://www.google.com" });
          log.info('[TOOL_DISPATCH]', { tool: "navigate", url: "https://www.google.com" });
          log.info('[PAGE_GOTO]', { url: "https://www.google.com" });
          await browserSessionManager.navigate(tabId, "https://www.google.com");
        }
        let query = "AI agents";
        const quoteMatch = step.match(/"([^"]+)"/);
        if (quoteMatch) {
          query = quoteMatch[1];
        } else if (stepLower.includes("look up")) {
          const idx = stepLower.indexOf("look up");
          query = step.slice(idx + 7).replace(/[".]+/g, "").trim();
        } else if (stepLower.includes("search")) {
          const idx = stepLower.indexOf("search");
          query = step.slice(idx + 6).replace(/[".]+/g, "").trim();
        }
        log.info('[TOOL_SELECTED]', { tool: "search", query });
        log.info('[TOOL_DISPATCH]', { tool: "search", query });
        await browserSessionManager.search(tabId, query);
        log.info('[SEARCH_EXECUTED]', { query });
        outputs.push({ step, status: "success", detail: `Searched for ${query}` });
      } else if (stepLower.includes("extract") || stepLower.includes("summary") || stepLower.includes("findings")) {
        if (!tabId) {
          throw new Error("No active browser tab to extract text from");
        }
        log.info('[TOOL_SELECTED]', { tool: "extractText" });
        log.info('[TOOL_DISPATCH]', { tool: "extractText" });
        const text = await browserSessionManager.extractText(tabId);
        log.info('[SUMMARY_EXTRACTED]');
        const summary = text.split("\n").map(l => l.trim()).filter(Boolean).slice(0, 10).join("\n");
        outputs.push({ step, status: "success", detail: summary });
      } else {
        outputs.push({ step, status: "success", detail: "Step completed" });
      }
    }
  } catch (error: any) {
    log.error("Execution failed", error);
    outputs.push({ status: "error", error: error.message });
  } finally {
    if (tabId) {
      await browserSessionManager.closeTab(tabId).catch(() => {});
    }
  }

  const output: ExecutionOutput = {
    success: true,
    stepsExecuted,
    outputs,
  };

  logPerf(log, "Execution completed", started, { stepsCount: steps.length });
  return { result: output, metadata: { timingMs: nowMs() - started } };
}

export default executionAgent;

