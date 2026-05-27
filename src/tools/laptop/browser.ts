import { existsSync, statSync } from "node:fs";
import { env } from "@config/index.js";
import { createLogger } from "@utils/logger.js";
import { createToolFailure, createToolSuccess, type ToolResult, withToolTimeout } from "@tools/toolResult.js";
import type { Browser, BrowserContext, Page } from "playwright";

const log = createLogger("tools/browser");
console.log("[MODULE LOAD]", import.meta.url);

interface PlaywrightSingletonState {
  instanceId: string;
  browserInstance: Browser | null;
  browserContext: BrowserContext | null;
  managedPage: Page | null;
}

const singletonState = (globalThis as typeof globalThis & { __createrPlaywrightSingleton?: PlaywrightSingletonState })
  .__createrPlaywrightSingleton ??= {
  instanceId: "playwright-singleton-v1",
  browserInstance: null,
  browserContext: null,
  managedPage: null,
};

console.log("[PLAYWRIGHT SINGLETON INSTANCE]", singletonState.instanceId);

const BROWSER_TIMEOUT_MS = 30000;

function sameDocumentUrl(expectedUrl: string, actualUrl: string): boolean {
  return actualUrl === expectedUrl || actualUrl.startsWith(expectedUrl);
}

async function getBrowser(): Promise<Browser> {
  if (singletonState.browserInstance) return singletonState.browserInstance;
  const { chromium, firefox, webkit } = await import("playwright");
  const browsers = { chromium, firefox, webkit };
  const browserType = browsers[env.PLAYWRIGHT_BROWSER as keyof typeof browsers] ?? chromium;
  singletonState.browserInstance = await browserType.launch({ headless: env.PLAYWRIGHT_HEADLESS });
  log.info(`Browser launched: ${env.PLAYWRIGHT_BROWSER} (headless=${env.PLAYWRIGHT_HEADLESS})`);
  return singletonState.browserInstance;
}

async function getContext(): Promise<BrowserContext> {
  if (singletonState.browserContext) return singletonState.browserContext;
  const browser = await getBrowser();
  singletonState.browserContext = await browser.newContext();
  return singletonState.browserContext;
}

export async function getManagedPage(): Promise<Page> {
  if (singletonState.managedPage && !singletonState.managedPage.isClosed()) return singletonState.managedPage;
  const context = await getContext();
  singletonState.managedPage = await context.newPage();
  return singletonState.managedPage;
}

export async function navigateToUrl(url: string): Promise<ToolResult> {
  const startedAt = Date.now();
  console.log("[PLAYWRIGHT PATH]", "src/tools/laptop/browser.ts", "navigateToUrl", url);
  console.log("[BROWSER NAVIGATION]", url);
  console.log("[EXECUTION ATTEMPTED]", { toolId: "browser.navigate", url });

  try {
    const page = await withToolTimeout(getManagedPage(), BROWSER_TIMEOUT_MS, "browser.navigate.page");
    const response = await withToolTimeout(
      page.goto(url, { waitUntil: "domcontentloaded", timeout: BROWSER_TIMEOUT_MS }),
      BROWSER_TIMEOUT_MS,
      "browser.navigate.goto"
    );

    console.log("[EXECUTION VERIFICATION START]", { toolId: "browser.navigate", url });
    const verified = !page.isClosed() && sameDocumentUrl(url, page.url());
    if (!verified) {
      console.log("[EXECUTION VERIFICATION FAILED]", { toolId: "browser.navigate", url, actualUrl: page.url() });
      return createToolFailure(
        "browser.navigate",
        startedAt,
        `I tried to open ${url}, but the browser page could not be verified.`,
        "Navigation completed without confirming the target page.",
        { actualUrl: page.url(), responseStatus: response?.status() }
      );
    }

    const title = await page.title();
    console.log("[EXECUTION VERIFIED SUCCESS]", { toolId: "browser.navigate", url, title });
    return createToolSuccess("browser.navigate", startedAt, `Browser opened ${url}.`, {
      verified: true,
      data: {
        title,
        url: page.url(),
        responseStatus: response?.status(),
      },
    });
  } catch (error) {
    log.error("navigateToUrl failed", error, { url });
    console.log("[EXECUTION VERIFICATION FAILED]", { toolId: "browser.navigate", url, error: String(error) });
    return createToolFailure(
      "browser.navigate",
      startedAt,
      `I tried to open ${url}, but browser navigation failed.`,
      error instanceof Error ? error.message : String(error),
      { url }
    );
  }
}

export async function extractText(url: string): Promise<ToolResult> {
  const startedAt = Date.now();
  console.log("[PLAYWRIGHT PATH]", "src/tools/laptop/browser.ts", "extractText", url);
  try {
    const page = await withToolTimeout(getManagedPage(), BROWSER_TIMEOUT_MS, "browser.extract_text.page");
    await withToolTimeout(
      page.goto(url, { waitUntil: "domcontentloaded", timeout: BROWSER_TIMEOUT_MS }),
      BROWSER_TIMEOUT_MS,
      "browser.extract_text.goto"
    );
    const text = await withToolTimeout(
      page.evaluate(() => document.body.innerText),
      BROWSER_TIMEOUT_MS,
      "browser.extract_text.read"
    );
    return createToolSuccess("browser.extract_text", startedAt, `Extracted text from ${url}.`, {
      verified: true,
      data: { url: page.url(), text: (text as string).slice(0, 5000) },
    });
  } catch (error) {
    log.error("extractText failed", error, { url });
    return createToolFailure(
      "browser.extract_text",
      startedAt,
      `I tried to extract text from ${url}, but it failed.`,
      error instanceof Error ? error.message : String(error),
      { url }
    );
  }
}

export async function takeScreenshot(url: string, savePath: string): Promise<ToolResult> {
  const startedAt = Date.now();
  console.log("[PLAYWRIGHT PATH]", "src/tools/laptop/browser.ts", "takeScreenshot", { url, savePath });
  console.log("[EXECUTION ATTEMPTED]", { toolId: "browser.screenshot", url, savePath });

  try {
    const page = await withToolTimeout(getManagedPage(), BROWSER_TIMEOUT_MS, "browser.screenshot.page");
    await withToolTimeout(
      page.goto(url, { waitUntil: "networkidle", timeout: BROWSER_TIMEOUT_MS }),
      BROWSER_TIMEOUT_MS,
      "browser.screenshot.goto"
    );
    await withToolTimeout(
      page.screenshot({ path: savePath, fullPage: false }),
      BROWSER_TIMEOUT_MS,
      "browser.screenshot.capture"
    );

    console.log("[EXECUTION VERIFICATION START]", { toolId: "browser.screenshot", savePath });
    const verified = existsSync(savePath) && statSync(savePath).size > 0;
    if (!verified) {
      console.log("[EXECUTION VERIFICATION FAILED]", { toolId: "browser.screenshot", savePath });
      return createToolFailure(
        "browser.screenshot",
        startedAt,
        "I tried to take the screenshot, but the file could not be verified.",
        "Screenshot file was not created.",
        { savePath, url }
      );
    }

    console.log("[EXECUTION VERIFIED SUCCESS]", { toolId: "browser.screenshot", savePath });
    return createToolSuccess("browser.screenshot", startedAt, `Screenshot saved: ${savePath}`, {
      verified: true,
      data: { savePath, url: page.url() },
    });
  } catch (error) {
    log.error("takeScreenshot failed", error, { url, savePath });
    return createToolFailure(
      "browser.screenshot",
      startedAt,
      "I tried to take the screenshot, but it failed.",
      error instanceof Error ? error.message : String(error),
      { savePath, url }
    );
  }
}

export async function closeBrowser(): Promise<ToolResult> {
  const startedAt = Date.now();
  console.log("[PLAYWRIGHT PATH]", "src/tools/laptop/browser.ts", "closeBrowser");

  try {
    if (singletonState.managedPage && !singletonState.managedPage.isClosed()) {
      await singletonState.managedPage.close();
      singletonState.managedPage = null;
    }
    if (singletonState.browserContext) {
      await singletonState.browserContext.close();
      singletonState.browserContext = null;
    }
    if (singletonState.browserInstance) {
      await singletonState.browserInstance.close();
      singletonState.browserInstance = null;
    }
    log.info("Browser closed");
    return createToolSuccess("computer.close_browser", startedAt, "Browser closed.", {
      verified: true,
    });
  } catch (error) {
    log.error("closeBrowser failed", error);
    return createToolFailure(
      "computer.close_browser",
      startedAt,
      "I tried to close the browser, but it failed.",
      error instanceof Error ? error.message : String(error)
    );
  }
}
