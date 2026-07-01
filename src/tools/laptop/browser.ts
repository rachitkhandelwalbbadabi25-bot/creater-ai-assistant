// ════════════════════════════════════════════════════════════════════════════════
// src/tools/laptop/browser.ts — Browser automation via Playwright (Phase 5.2)
// Wrapped with executeTool() for retries, timeouts, metrics, and recovery.
// ════════════════════════════════════════════════════════════════════════════════

import { env } from "@config/index.js";
import { createLogger } from "@utils/logger.js";
import { ToolError } from "@utils/errorHandler.js";
import { executeTool } from "../../agents/toolExecutor.js";
import {
  recordBrowserRetry,
  recordBrowserFailure,
  recordBrowserSuccess,
  recordTimeout,
} from "../toolMetrics.js";

const log = createLogger("tools/browser");

let browserInstance: any = null;
let launchInProgress: Promise<any> | null = null;
let idleTimer: NodeJS.Timeout | null = null;
const IDLE_TIMEOUT_MS: number =
  Number(process.env.PLAYWRIGHT_IDLE_TIMEOUT_MS) || 5 * 60 * 1000;

// ─── Browser Lifecycle ────────────────────────────────────────────────────────

async function launchBrowser(): Promise<any> {
  const { chromium, firefox, webkit } = await import("playwright");
  const browsers = { chromium, firefox, webkit };
  const browserType =
    browsers[env.PLAYWRIGHT_BROWSER as keyof typeof browsers] ?? chromium;
  const instance = await browserType.launch({ headless: env.PLAYWRIGHT_HEADLESS });
  browserInstance = instance;
  log.info(`Browser launched: ${env.PLAYWRIGHT_BROWSER} (headless=${env.PLAYWRIGHT_HEADLESS})`);
  log.info("PLAYWRIGHT SINGLETON VERIFIED");
  resetIdleTimer();
  return instance;
}

async function getBrowser(): Promise<any> {
  // Reuse an existing, still-connected browser
  if (browserInstance && browserInstance.isConnected?.()) {
    log.info("EXISTING BROWSER REUSED");
    return browserInstance;
  }

  // If a launch is already in progress, wait for it
  if (launchInProgress) {
    log.info("DUPLICATE BROWSER LAUNCH PREVENTED");
    await launchInProgress;
    return browserInstance;
  }

  // Wrap launch in executeTool for retry + timeout
  console.log("[TOOL_EXECUTION_START] browser.launch");
  const start = Date.now();

  launchInProgress = (async () => {
    const res = await executeTool(() => launchBrowser(), {
      maxAttempts: 3,
      baseDelayMs: 500,
      timeoutMs: 30000,
    });

    if (!res.success) {
      console.log("[TOOL_EXECUTION_FAILED] browser.launch", res.error);
      if (res.error?.includes("timeout")) recordTimeout();
      recordBrowserFailure();
      launchInProgress = null;
      throw new ToolError("browser.launch", res.error ?? "Failed to launch browser");
    }

    console.log("[TOOL_EXECUTION_SUCCESS] browser.launch");
    recordBrowserSuccess(Date.now() - start);
  })();

  await launchInProgress;
  launchInProgress = null;
  return browserInstance;
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch {
      // ignore – already closed
    }
    browserInstance = null;
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    log.info("Browser closed");
  }
}

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    log.info("PLAYWRIGHT AUTO CLOSE TRIGGERED");
    await closeBrowser();
    log.info("PLAYWRIGHT CLEANUP COMPLETE");
  }, IDLE_TIMEOUT_MS);
  log.info("PLAYWRIGHT IDLE TIMER STARTED");
}

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
      const browser = await getBrowser();
      resetIdleTimer();
      const page = await browser.newPage();
      try {
        const result = await fn(page);
        return result;
      } finally {
        // Always close the page after use
        await page.close().catch(() => {});
      }
    },
    retryPolicy
  );

  if (res.success) {
    console.log(`[TOOL_EXECUTION_SUCCESS] ${operationName}`);
    if (lastAttempt > 1) console.log(`[BROWSER_RETRY_SUCCESS] ${operationName}`);
    recordBrowserSuccess(Date.now() - start);
    return res.result as T;
  }

  // Recovery: close stale browser so next call recreates it
  console.log(`[TOOL_EXECUTION_FAILED] ${operationName}`, res.error);
  if (lastAttempt > 1) console.log(`[BROWSER_RETRY_FAILED] ${operationName}`);
  if (res.error?.includes("timeout")) recordTimeout();
  recordBrowserFailure();
  await closeBrowser();

  throw new ToolError(operationName, res.error ?? `${operationName} failed`);
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
