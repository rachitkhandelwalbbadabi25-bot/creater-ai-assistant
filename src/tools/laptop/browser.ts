// ════════════════════════════════════════════════════════════════════════════════
// src/tools/laptop/browser.ts — Browser automation via Playwright
// Delegated to authoritative browserSessionManager in src/mcp/browser/sessionManager.ts
// Wrapped with executeTool() for retries, timeouts, metrics, and recovery.
// ════════════════════════════════════════════════════════════════════════════════

import { createLogger } from "@utils/logger.js";
import { ToolError } from "@utils/errorHandler.js";
import { executeTool } from "../../agents/toolExecutor.js";
import { browserSessionManager } from "../../mcp/browser/sessionManager.js";
import {
  recordBrowserRetry,
  recordBrowserFailure,
  recordBrowserSuccess,
  recordTimeout,
} from "../toolMetrics.js";

const log = createLogger("tools/browser");

// ─── Browser Recovery Helpers ─────────────────────────────────────────────────

async function withPage<T>(
  fn: (page: any) => Promise<T>,
  operationName: string,
  retryPolicy = { maxAttempts: 3, baseDelayMs: 500, timeoutMs: 30000 }
): Promise<T> {
  const start = Date.now();
  console.log(`[TOOL_EXECUTION_START] ${operationName}`);

  let lastAttempt = 0;

  const res = await executeTool(
    async () => {
      lastAttempt++;
      if (lastAttempt > 1) {
        console.log(`[BROWSER_RETRY_START] ${operationName} attempt ${lastAttempt}`);
        recordBrowserRetry();
      }
      return await browserSessionManager.executeOnPage(fn);
    },
    retryPolicy
  );

  if (res.success) {
    console.log(`[TOOL_EXECUTION_SUCCESS] ${operationName}`);
    if (lastAttempt > 1) console.log(`[BROWSER_RETRY_SUCCESS] ${operationName}`);
    recordBrowserSuccess(Date.now() - start);
    return res.result as T;
  }

  // Recovery: cleanup sessions so next call recreates cleanly
  console.log(`[TOOL_EXECUTION_FAILED] ${operationName}`, res.error);
  if (lastAttempt > 1) console.log(`[BROWSER_RETRY_FAILED] ${operationName}`);
  if (res.error?.includes("timeout")) recordTimeout();
  recordBrowserFailure();
  await browserSessionManager.cleanupAll().catch(() => {});

  throw new ToolError(operationName, res.error ?? `${operationName} failed`);
}

export async function closeBrowser(): Promise<void> {
  await browserSessionManager.cleanupAll();
  log.info("Browser session cleaned up");
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function navigateToUrl(url: string): Promise<string> {
  log.tool(`Navigating to: ${url}`);
  return withPage(
    async (page) => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      return page.title();
    },
    "browser.navigateToUrl"
  );
}

export async function extractText(url: string): Promise<string> {
  log.tool(`Extracting text from: ${url}`);
  return withPage(
    async (page) => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      const text = await page.evaluate(() => document.body.innerText);
      return (text as string).slice(0, 5000); // Cap at 5k chars
    },
    "browser.extractText"
  );
}

export async function takeScreenshot(url: string, savePath: string): Promise<string> {
  log.tool(`Screenshot: ${url} → ${savePath}`);
  return withPage(
    async (page) => {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      await page.screenshot({ path: savePath, fullPage: false });
      return savePath;
    },
    "browser.takeScreenshot",
    { maxAttempts: 2, baseDelayMs: 500, timeoutMs: 45000 }
  );
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

process.on("SIGINT", async () => {
  log.info("Process SIGINT received, closing browser");
  await closeBrowser();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  log.info("Process SIGTERM received, closing browser");
  await closeBrowser();
  process.exit(0);
});
process.on("exit", async () => {
  log.info("Process exit event, ensuring browser is closed");
  await closeBrowser();
});

