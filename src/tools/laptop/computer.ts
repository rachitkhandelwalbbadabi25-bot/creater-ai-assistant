// ════════════════════════════════════════════════════════════════════════════════
// src/tools/laptop/computer.ts — Computer control via Playwright
// Delegated to authoritative browserSessionManager in src/mcp/browser/sessionManager.ts
// Wrapped with executeTool() for retries, timeouts, metrics, and recovery.
// ════════════════════════════════════════════════════════════════════════════════

import { type Page } from "playwright";
import { createLogger } from "@utils/logger.js";
import { openUrl } from "./launcher.js";
import { executeTool } from "../../agents/toolExecutor.js";
import { browserSessionManager } from "../../mcp/browser/sessionManager.js";
import {
  recordComputerRetry,
  recordComputerFailure,
  recordComputerSuccess,
  recordTimeout,
} from "../toolMetrics.js";

const log = createLogger("tools/computer");

// ─── Retry policy for computer actions ───────────────────────────────────────
const COMPUTER_POLICY = { maxAttempts: 2, baseDelayMs: 300, timeoutMs: 10000 };

// ─── Internal helper delegating to browserSessionManager ───────────────────────
async function withComputerAction<T>(
  operationName: string,
  fn: (page: Page) => Promise<T>,
  policy = COMPUTER_POLICY
): Promise<string> {
  const start = Date.now();
  console.log(`[TOOL_EXECUTION_START] ${operationName}`);
  let attempts = 0;

  const res = await executeTool(async () => {
    attempts++;
    if (attempts > 1) {
      console.log(`[BROWSER_RETRY_START] ${operationName} attempt ${attempts}`);
      recordComputerRetry();
    }
    return browserSessionManager.executeOnPage(fn);
  }, policy);

  if (res.success) {
    console.log(`[TOOL_EXECUTION_SUCCESS] ${operationName}`);
    if (attempts > 1) console.log(`[BROWSER_RETRY_SUCCESS] ${operationName}`);
    recordComputerSuccess(Date.now() - start);
    return res.result as string;
  }

  console.log(`[TOOL_EXECUTION_FAILED] ${operationName}`, res.error);
  if (attempts > 1) console.log(`[BROWSER_RETRY_FAILED] ${operationName}`);
  if (res.error?.includes("timeout")) recordTimeout();
  recordComputerFailure();

  // Recovery: cleanup sessions on failure so next call recreates cleanly
  await browserSessionManager.cleanupAll().catch(() => {});

  const msg = res.error ?? `${operationName} failed`;
  log.error(`${operationName} failed`, { error: msg });
  return `${operationName} failed: ${msg}`;
}

// ─── Open URL in default browser ─────────────────────────────────────────────

async function openUrlInBrowser(url: string): Promise<void> {
  console.log("[LAUNCH TRACE]", "src/tools/laptop/computer.ts", "openUrlInBrowser", url);
  await openUrl(url);
}

// ─── Browser Management ───────────────────────────────────────────────────────

export async function openBrowser(url?: string): Promise<string> {
  const target = url || "https://www.google.com";
  console.log("[LAUNCH TRACE]", "src/tools/laptop/computer.ts", "openBrowser", target);
  return withComputerAction("computer.openBrowser", async (page) => {
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
    return `Browser opened: ${target}`;
  });
}

export async function navigateTo(url: string): Promise<string> {
  console.log("[LAUNCH TRACE]", "src/tools/laptop/computer.ts", "navigateTo", url);
  return openBrowser(url);
}

export async function closeBrowserWindow(): Promise<string> {
  await browserSessionManager.cleanupAll();
  return "Browser closed";
}

// ─── Mouse Control ────────────────────────────────────────────────────────────

export async function clickAt(x: number, y: number): Promise<string> {
  return withComputerAction("computer.clickAt", async (page) => {
    await page.mouse.click(x, y);
    return `Clicked at (${x}, ${y})`;
  });
}

export async function clickSelector(selector: string): Promise<string> {
  return withComputerAction("computer.clickSelector", async (page) => {
    await page.click(selector, { timeout: 5000 });
    return `Clicked: ${selector}`;
  });
}

export async function rightClick(x: number, y: number): Promise<string> {
  return withComputerAction("computer.rightClick", async (page) => {
    await page.mouse.click(x, y, { button: "right" });
    return `Right clicked at (${x}, ${y})`;
  });
}

export async function scrollPage(direction: "up" | "down", amount: number = 300): Promise<string> {
  return withComputerAction("computer.scrollPage", async (page) => {
    await page.mouse.wheel(0, direction === "down" ? amount : -amount);
    return `Scrolled ${direction} by ${amount}px`;
  });
}

export async function hoverAt(selector: string): Promise<string> {
  return withComputerAction("computer.hoverAt", async (page) => {
    await page.hover(selector);
    return `Hovered over: ${selector}`;
  });
}

// ─── Keyboard Control ─────────────────────────────────────────────────────────

export async function typeText(text: string, selector?: string): Promise<string> {
  return withComputerAction("computer.typeText", async (page) => {
    if (selector) await page.click(selector);
    await page.keyboard.type(text, { delay: 50 });
    return `Typed: "${text}"`;
  });
}

export async function pressKey(key: string): Promise<string> {
  return withComputerAction("computer.pressKey", async (page) => {
    await page.keyboard.press(key);
    return `Pressed key: ${key}`;
  });
}

export async function keyboardShortcut(shortcut: string): Promise<string> {
  return withComputerAction("computer.keyboardShortcut", async (page) => {
    await page.keyboard.press(shortcut);
    return `Shortcut pressed: ${shortcut}`;
  });
}

// ─── Screen Reading ───────────────────────────────────────────────────────────

export async function getPageText(): Promise<string> {
  return withComputerAction("computer.getPageText", async (page) => {
    const text = await page.evaluate(() => document.body.innerText);
    return (text as string).slice(0, 3000);
  });
}

export async function getPageTitle(): Promise<string> {
  return withComputerAction("computer.getPageTitle", async (page) => {
    return page.title();
  });
}

export async function findElement(selector: string): Promise<string> {
  return withComputerAction("computer.findElement", async (page) => {
    const el = await page.$(selector);
    if (!el) return `Element not found: ${selector}`;
    const text = await el.textContent();
    return `Found: ${text?.slice(0, 200)}`;
  });
}

export async function takeScreenshotOfPage(): Promise<string> {
  return withComputerAction(
    "computer.takeScreenshotOfPage",
    async (page) => {
      const path = `./screenshot_${Date.now()}.png`;
      await page.screenshot({ path, fullPage: false });
      return `Screenshot saved: ${path}`;
    },
    { maxAttempts: 2, baseDelayMs: 300, timeoutMs: 20000 }
  );
}

// ─── Smart Actions ────────────────────────────────────────────────────────────

export async function searchOnPage(searchText: string): Promise<string> {
  return withComputerAction("computer.searchOnPage", async (page) => {
    await page.keyboard.press("Control+f");
    await page.keyboard.type(searchText);
    return `Searching for: ${searchText}`;
  });
}

export async function fillForm(selector: string, value: string): Promise<string> {
  return withComputerAction("computer.fillForm", async (page) => {
    await page.fill(selector, value);
    return `Filled form field ${selector} with: ${value}`;
  });
}

export async function selectDropdown(selector: string, value: string): Promise<string> {
  return withComputerAction("computer.selectDropdown", async (page) => {
    await page.selectOption(selector, value);
    return `Selected: ${value}`;
  });
}

export async function waitForElement(selector: string, timeout: number = 5000): Promise<string> {
  return withComputerAction(
    "computer.waitForElement",
    async (page) => {
      await page.waitForSelector(selector, { timeout });
      return `Element found: ${selector}`;
    },
    { maxAttempts: 2, baseDelayMs: 300, timeoutMs: timeout + 2000 }
  );
}

// ─── YouTube Specific ─────────────────────────────────────────────────────────

export async function playYouTube(query: string): Promise<string> {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  console.log("[LAUNCH TRACE]", "src/tools/laptop/computer.ts", "playYouTube", searchUrl);
  return openBrowser(searchUrl);
}

