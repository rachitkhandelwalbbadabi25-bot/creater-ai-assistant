import { createInterface } from "node:readline";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, firefox, webkit, type Browser, type BrowserContext, type BrowserType, type Page } from "playwright";
import {
  createToolFailure,
  createToolSuccess,
  type ToolResult,
  withToolTimeout,
} from "../toolResult.ts";
import type { BrowserWorkerRequest, BrowserWorkerResponse } from "./protocol.ts";

console.log = (...args: unknown[]) => {
  console.error(...args);
};

const BROWSER_LAUNCH_TIMEOUT_MS = 15000;
const BROWSER_CONTEXT_TIMEOUT_MS = 10000;
const BROWSER_PAGE_TIMEOUT_MS = 10000;
const BROWSER_NAVIGATION_TIMEOUT_MS = 20000;
const BROWSER_CLOSE_TIMEOUT_MS = 30000;
const DEFAULT_HEADLESS = process.env.PLAYWRIGHT_HEADLESS !== "false";
const CONFIGURED_BROWSER = process.env.PLAYWRIGHT_BROWSER ?? "chromium";
const workerState: {
  browser: Browser | null;
  context: BrowserContext | null;
  page: Page | null;
  diagnostics: BrowserDiagnostics | null;
} = {
  browser: null,
  context: null,
  page: null,
  diagnostics: null,
};

interface BrowserDiagnostics {
  runtime: "node";
  platform: NodeJS.Platform;
  cwd: string;
  tempProfileDir: string;
  downloadsPath: string;
  configuredBrowser: string;
  configuredHeadless: boolean;
  executablePath: string;
  userDataDir: string | null;
}

interface BrowserLifecycleTimings {
  browserLaunchMs?: number;
  contextCreationMs?: number;
  pageCreationMs?: number;
  navigationMs?: number;
  verificationMs?: number;
  closeMs?: number;
}

const browserTypes: Record<string, BrowserType> = {
  chromium,
  firefox,
  webkit,
};

function workerLog(event: string, data?: Record<string, unknown>): void {
  if (data) {
    console.error(event, data);
  } else {
    console.error(event);
  }
}

function cleanupDiagnostics(diagnostics: BrowserDiagnostics | null | undefined): void {
  if (!diagnostics) return;
  for (const target of [diagnostics.tempProfileDir, diagnostics.downloadsPath]) {
    try {
      rmSync(target, { recursive: true, force: true });
    } catch {}
  }
}

function createDiagnostics(headless: boolean): BrowserDiagnostics {
  const browserType = browserTypes[CONFIGURED_BROWSER] ?? chromium;
  const tempProfileDir = mkdtempSync(join(tmpdir(), "creater-browser-worker-profile-"));
  const downloadsPath = mkdtempSync(join(tmpdir(), "creater-browser-worker-downloads-"));
  const executablePath = browserType.executablePath();
  const diagnostics: BrowserDiagnostics = {
    runtime: "node",
    platform: process.platform,
    cwd: process.cwd(),
    tempProfileDir,
    downloadsPath,
    configuredBrowser: CONFIGURED_BROWSER,
    configuredHeadless: headless,
    executablePath,
    userDataDir: null,
  };

  workerLog("PLAYWRIGHT EXECUTABLE PATH", { executablePath });
  workerLog("PLAYWRIGHT BROWSER FOUND", {
    exists: existsSync(executablePath),
    browser: CONFIGURED_BROWSER,
  });
  workerLog("PLAYWRIGHT LAUNCH OPTIONS", { ...diagnostics });

  return diagnostics;
}

async function measureStage<T>(
  timings: BrowserLifecycleTimings,
  key: keyof BrowserLifecycleTimings,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    timings[key] = Date.now() - startedAt;
  }
}

function getBrowserType(): BrowserType {
  return browserTypes[CONFIGURED_BROWSER] ?? chromium;
}

async function launchBrowser(headless: boolean, timings: BrowserLifecycleTimings): Promise<void> {
  if (workerState.browser && workerState.context && workerState.page && !workerState.page.isClosed()) return;

  const diagnostics = createDiagnostics(headless);
  workerLog("BROWSER LAUNCH START", {
    browser: CONFIGURED_BROWSER,
    headless,
    cwd: diagnostics.cwd,
    tempProfileDir: diagnostics.tempProfileDir,
    downloadsPath: diagnostics.downloadsPath,
  });

  try {
    const browserType = getBrowserType();
    workerState.browser = await measureStage(timings, "browserLaunchMs", async () =>
      await withToolTimeout(
        browserType.launch({
          headless,
          timeout: BROWSER_LAUNCH_TIMEOUT_MS,
          executablePath: diagnostics.executablePath,
          downloadsPath: diagnostics.downloadsPath,
        }),
        BROWSER_LAUNCH_TIMEOUT_MS,
        "browser.worker.launch"
      )
    );
    workerLog("BROWSER LAUNCH SUCCESS", {
      browser: CONFIGURED_BROWSER,
      headless,
      durationMs: timings.browserLaunchMs,
    });

    workerState.context = await measureStage(timings, "contextCreationMs", async () =>
      await withToolTimeout(
        workerState.browser!.newContext(),
        BROWSER_CONTEXT_TIMEOUT_MS,
        "browser.worker.context"
      )
    );
    workerState.page = await measureStage(timings, "pageCreationMs", async () =>
      await withToolTimeout(
        workerState.context!.newPage(),
        BROWSER_PAGE_TIMEOUT_MS,
        "browser.worker.page"
      )
    );
    workerLog("PAGE CREATED", {
      contextCreationMs: timings.contextCreationMs,
      pageCreationMs: timings.pageCreationMs,
    });
    workerState.diagnostics = diagnostics;
  } catch (error) {
    cleanupDiagnostics(diagnostics);
    workerState.browser = null;
    workerState.context = null;
    workerState.page = null;
    workerState.diagnostics = null;
    throw error;
  }
}

async function ensurePage(timings: BrowserLifecycleTimings): Promise<Page> {
  if (workerState.page && !workerState.page.isClosed()) return workerState.page;
  await launchBrowser(DEFAULT_HEADLESS, timings);
  if (!workerState.page) throw new Error("Browser worker could not create a page.");
  return workerState.page;
}

function sameDocumentUrl(expectedUrl: string, actualUrl: string): boolean {
  try {
    const expected = new URL(expectedUrl);
    const actual = new URL(actualUrl);
    const expectedHost = expected.hostname.replace(/^www\./i, "").toLowerCase();
    const actualHost = actual.hostname.replace(/^www\./i, "").toLowerCase();
    if (expectedHost !== actualHost) return false;
    if (expected.pathname !== "/" && !actual.pathname.startsWith(expected.pathname)) return false;
    return true;
  } catch {
    return actualUrl === expectedUrl || actualUrl.startsWith(expectedUrl);
  }
}

async function closeWorkerBrowser(): Promise<BrowserLifecycleTimings> {
  const timings: BrowserLifecycleTimings = {};
  await measureStage(timings, "closeMs", async () => {
    if (workerState.page && !workerState.page.isClosed()) {
      await withToolTimeout(workerState.page.close(), BROWSER_CLOSE_TIMEOUT_MS, "browser.worker.close.page");
    }
    if (workerState.context) {
      await withToolTimeout(workerState.context.close(), BROWSER_CLOSE_TIMEOUT_MS, "browser.worker.close.context");
    }
    if (workerState.browser) {
      await withToolTimeout(workerState.browser.close(), BROWSER_CLOSE_TIMEOUT_MS, "browser.worker.close.browser");
    }
  });
  cleanupDiagnostics(workerState.diagnostics);
  workerState.browser = null;
  workerState.context = null;
  workerState.page = null;
  workerState.diagnostics = null;
  workerLog("BROWSER CONTEXT CLOSED", { durationMs: timings.closeMs });
  return timings;
}

async function navigateInternal(url: string, toolId: string, verifyMessage: string): Promise<ToolResult> {
  const startedAt = Date.now();
  const timings: BrowserLifecycleTimings = {};

  try {
    const page = await ensurePage(timings);
    workerLog("NAVIGATION START", { url, toolId });
    const response = await measureStage(timings, "navigationMs", async () =>
      await withToolTimeout(
        page.goto(url, { waitUntil: "domcontentloaded", timeout: BROWSER_NAVIGATION_TIMEOUT_MS }),
        BROWSER_NAVIGATION_TIMEOUT_MS,
        `${toolId}.goto`
      )
    );
    workerLog("NAVIGATION SUCCESS", {
      url,
      toolId,
      durationMs: timings.navigationMs,
      responseStatus: response?.status(),
    });

    const verified = await measureStage(
      timings,
      "verificationMs",
      async () => !page.isClosed() && sameDocumentUrl(url, page.url())
    );
    if (!verified) {
      return createToolFailure(
        toolId,
        startedAt,
        verifyMessage,
        "Navigation completed without confirming the target page.",
        { actualUrl: page.url(), responseStatus: response?.status(), timings }
      );
    }

    workerLog("PAGE URL VERIFIED", {
      expectedUrl: url,
      actualUrl: page.url(),
      durationMs: timings.verificationMs,
    });
    return createToolSuccess(toolId, startedAt, `Browser opened ${url}.`, {
      verified: true,
      data: {
        url: page.url(),
        title: await page.title(),
        responseStatus: response?.status(),
        timings,
      },
    });
  } catch (error) {
    return createToolFailure(
      toolId,
      startedAt,
      verifyMessage,
      error instanceof Error ? error.message : String(error),
      { timings }
    );
  }
}

async function testRawBrowserLaunchInternal(): Promise<ToolResult> {
  const startedAt = Date.now();
  const attempts: Array<{ headless: boolean; success: boolean; durationMs: number; error?: string }> = [];

  for (const headless of [true, false]) {
    const timings: BrowserLifecycleTimings = {};
    const attemptStartedAt = Date.now();
    try {
      await launchBrowser(headless, timings);
      await closeWorkerBrowser();
      attempts.push({ headless, success: true, durationMs: Date.now() - attemptStartedAt });
      return createToolSuccess("browser.test_raw_launch", startedAt, "Raw browser launch test passed.", {
        verified: true,
        data: { attempts },
      });
    } catch (error) {
      attempts.push({
        headless,
        success: false,
        durationMs: Date.now() - attemptStartedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      await closeWorkerBrowser().catch(() => undefined);
    }
  }

  return createToolFailure(
    "browser.test_raw_launch",
    startedAt,
    "I tried to run the raw browser launch test, but every launch attempt failed.",
    attempts.map((attempt) => `${attempt.headless}:${attempt.error ?? "unknown error"}`).join(" | "),
    { attempts }
  );
}

async function handleRequest(request: BrowserWorkerRequest): Promise<ToolResult> {
  switch (request.action) {
    case "navigate":
      return await navigateInternal(String(request.params?.url ?? ""), "browser.navigate", `I tried to open ${String(request.params?.url ?? "")}, but browser navigation failed.`);
    case "extractText": {
      const startedAt = Date.now();
      try {
        const page = await ensurePage({});
        await withToolTimeout(
          page.goto(String(request.params?.url ?? ""), {
            waitUntil: "domcontentloaded",
            timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
          }),
          BROWSER_NAVIGATION_TIMEOUT_MS,
          "browser.extract_text.goto"
        );
        const text = await withToolTimeout(
          page.evaluate(() => document.body.innerText),
          BROWSER_NAVIGATION_TIMEOUT_MS,
          "browser.extract_text.read"
        );
        return createToolSuccess("browser.extract_text", startedAt, `Extracted text from ${String(request.params?.url ?? "")}.`, {
          verified: true,
          data: { url: page.url(), text: String(text).slice(0, 5000) },
        });
      } catch (error) {
        return createToolFailure(
          "browser.extract_text",
          startedAt,
          `I tried to extract text from ${String(request.params?.url ?? "")}, but it failed.`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
    case "screenshot": {
      const startedAt = Date.now();
      const savePath = String(request.params?.savePath ?? `./screenshot_${Date.now()}.png`);
      try {
        const page = await ensurePage({});
        if (request.params?.url) {
          await withToolTimeout(
            page.goto(String(request.params.url), {
              waitUntil: "networkidle",
              timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
            }),
            BROWSER_NAVIGATION_TIMEOUT_MS,
            "browser.screenshot.goto"
          );
        }
        await withToolTimeout(
          page.screenshot({ path: savePath, fullPage: false }),
          BROWSER_NAVIGATION_TIMEOUT_MS,
          "browser.screenshot.capture"
        );
        const verified = existsSync(savePath) && statSync(savePath).size > 0;
        if (!verified) {
          return createToolFailure(
            "browser.screenshot",
            startedAt,
            "I tried to take the screenshot, but the file could not be verified.",
            "Screenshot file was not created.",
            { savePath }
          );
        }
        return createToolSuccess("browser.screenshot", startedAt, `Screenshot saved: ${savePath}`, {
          verified: true,
          data: { savePath, url: page.url() },
        });
      } catch (error) {
        return createToolFailure(
          "browser.screenshot",
          startedAt,
          "I tried to take the screenshot, but it failed.",
          error instanceof Error ? error.message : String(error),
          { savePath }
        );
      }
    }
    case "closeBrowser": {
      const startedAt = Date.now();
      try {
        const timings = await closeWorkerBrowser();
        return createToolSuccess("computer.close_browser", startedAt, "Browser closed.", {
          verified: true,
          data: { timings },
        });
      } catch (error) {
        return createToolFailure(
          "computer.close_browser",
          startedAt,
          "I tried to close the browser, but it failed.",
          error instanceof Error ? error.message : String(error)
        );
      }
    }
    case "testBrowserExecution":
      return await navigateInternal(String(request.params?.url ?? ""), "browser.test_execution", `I tried to run a direct browser execution test for ${String(request.params?.url ?? "")}, but it failed.`);
    case "testRawBrowserLaunch":
      return await testRawBrowserLaunchInternal();
    case "clickAt": {
      const page = await ensurePage({});
      await page.mouse.click(Number(request.params?.x ?? 0), Number(request.params?.y ?? 0));
      return createToolSuccess("computer.click", Date.now(), `Clicked at (${Number(request.params?.x ?? 0)}, ${Number(request.params?.y ?? 0)})`, { verified: true });
    }
    case "clickSelector": {
      const page = await ensurePage({});
      await page.click(String(request.params?.selector ?? ""), { timeout: 5000 });
      return createToolSuccess("computer.click_selector", Date.now(), `Clicked: ${String(request.params?.selector ?? "")}`, { verified: true });
    }
    case "rightClick": {
      const page = await ensurePage({});
      await page.mouse.click(Number(request.params?.x ?? 0), Number(request.params?.y ?? 0), { button: "right" });
      return createToolSuccess("computer.right_click", Date.now(), `Right clicked at (${Number(request.params?.x ?? 0)}, ${Number(request.params?.y ?? 0)})`, { verified: true });
    }
    case "scrollPage": {
      const page = await ensurePage({});
      const amount = Number(request.params?.amount ?? 300);
      const direction = String(request.params?.direction ?? "down");
      await page.mouse.wheel(0, direction === "down" ? amount : -amount);
      return createToolSuccess("computer.scroll", Date.now(), `Scrolled ${direction} by ${amount}px`, { verified: true });
    }
    case "hoverAt": {
      const page = await ensurePage({});
      await page.hover(String(request.params?.selector ?? ""));
      return createToolSuccess("computer.hover", Date.now(), `Hovered over: ${String(request.params?.selector ?? "")}`, { verified: true });
    }
    case "typeText": {
      const page = await ensurePage({});
      if (request.params?.selector) {
        await page.click(String(request.params.selector));
      }
      await page.keyboard.type(String(request.params?.text ?? ""), { delay: 50 });
      return createToolSuccess("computer.type", Date.now(), `Typed: "${String(request.params?.text ?? "")}"`, { verified: true });
    }
    case "pressKey": {
      const page = await ensurePage({});
      await page.keyboard.press(String(request.params?.key ?? ""));
      return createToolSuccess("computer.press_key", Date.now(), `Pressed key: ${String(request.params?.key ?? "")}`, { verified: true });
    }
    case "keyboardShortcut": {
      const page = await ensurePage({});
      await page.keyboard.press(String(request.params?.shortcut ?? ""));
      return createToolSuccess("computer.shortcut", Date.now(), `Shortcut pressed: ${String(request.params?.shortcut ?? "")}`, { verified: true });
    }
    case "getPageText": {
      const page = await ensurePage({});
      const text = await page.evaluate(() => document.body.innerText);
      return createToolSuccess("computer.get_text", Date.now(), "Page text retrieved.", {
        verified: true,
        data: { text: String(text).slice(0, 3000) },
      });
    }
    case "getPageTitle": {
      const page = await ensurePage({});
      return createToolSuccess("computer.get_title", Date.now(), "Page title retrieved.", {
        verified: true,
        data: { title: await page.title() },
      });
    }
    case "findElement": {
      const page = await ensurePage({});
      const element = await page.$(String(request.params?.selector ?? ""));
      const text = element ? await element.textContent() : null;
      return createToolSuccess("computer.find_element", Date.now(), element ? `Found: ${text?.slice(0, 200) ?? ""}` : `Element not found: ${String(request.params?.selector ?? "")}`, {
        verified: element !== null,
        data: { text: text ?? null },
      });
    }
    case "fillForm": {
      const page = await ensurePage({});
      await page.fill(String(request.params?.selector ?? ""), String(request.params?.value ?? ""));
      return createToolSuccess("computer.fill_form", Date.now(), `Filled form field ${String(request.params?.selector ?? "")} with: ${String(request.params?.value ?? "")}`, { verified: true });
    }
    case "selectDropdown": {
      const page = await ensurePage({});
      await page.selectOption(String(request.params?.selector ?? ""), String(request.params?.value ?? ""));
      return createToolSuccess("computer.select_dropdown", Date.now(), `Selected: ${String(request.params?.value ?? "")}`, { verified: true });
    }
    case "waitForElement": {
      const page = await ensurePage({});
      await page.waitForSelector(String(request.params?.selector ?? ""), { timeout: Number(request.params?.timeout ?? 5000) });
      return createToolSuccess("computer.wait_for_element", Date.now(), `Element found: ${String(request.params?.selector ?? "")}`, { verified: true });
    }
    default:
      throw new Error(`Unsupported browser worker action: ${String((request as { action?: unknown }).action ?? "unknown")}`);
  }
}

workerLog("NODE BROWSER WORKER START", { pid: process.pid, cwd: process.cwd() });
workerLog("PLAYWRIGHT WORKER ACTIVE", { browser: CONFIGURED_BROWSER, headless: DEFAULT_HEADLESS });

const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

input.on("line", async (line) => {
  if (!line.trim()) return;

  let request: BrowserWorkerRequest;
  try {
    request = JSON.parse(line) as BrowserWorkerRequest;
  } catch (error) {
    const malformedResponse: BrowserWorkerResponse = {
      id: "unknown",
      error: error instanceof Error ? error.message : String(error),
    };
    process.stdout.write(`${JSON.stringify(malformedResponse)}\n`);
    return;
  }

  workerLog("WORKER REQUEST RECEIVED", { id: request.id, action: request.action });
  let response: BrowserWorkerResponse;
  try {
    response = {
      id: request.id,
      result: await handleRequest(request),
    };
  } catch (error) {
    response = {
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  workerLog("WORKER RESPONSE SENT", { id: request.id, action: request.action });
  workerLog("WORKER EXECUTION COMPLETE", { id: request.id, action: request.action });
  process.stdout.write(`${JSON.stringify(response)}\n`);
});
