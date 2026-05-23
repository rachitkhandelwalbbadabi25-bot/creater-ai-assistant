import { chromium, type Browser, type Page } from "playwright";
import { createLogger } from "@utils/logger.js";
import { openUrl } from "./launcher.js";

const log = createLogger("tools/computer");

let activeBrowser: Browser | null = null;
let activePage: Page | null = null;

/** Open a URL in the default browser (bypasses executor/safety checks). */
async function openUrlInBrowser(url: string): Promise<void> {
  console.log("[LAUNCH TRACE]", "src/tools/laptop/computer.ts", "openUrlInBrowser", url);
  await openUrl(url);
}

// Browser Management
export async function openBrowser(url?: string): Promise<string> {
  const target = url || "https://www.google.com";
  console.log("[LAUNCH TRACE]", "src/tools/laptop/computer.ts", "openBrowser", target);
  await openUrlInBrowser(target);
  return `Browser opened: ${target}`;
}

export async function navigateTo(url: string): Promise<string> {
  console.log("[LAUNCH TRACE]", "src/tools/laptop/computer.ts", "navigateTo", url);
  return openBrowser(url);
}

export async function closeBrowserWindow(): Promise<string> {
  try {
    if (activeBrowser) {
      await activeBrowser.close();
      activeBrowser = null;
      activePage = null;
    }
    return "Browser closed";
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("closeBrowserWindow failed", err);
    return `Browser close failed: ${errorMsg}`;
  }
}

// Mouse Control
export async function clickAt(x: number, y: number): Promise<string> {
  try {
    if (!activePage) throw new Error("No active browser. Open a browser first.");
    await activePage.mouse.click(x, y);
    return `Clicked at (${x}, ${y})`;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("clickAt failed", err);
    return `Click failed: ${errorMsg}`;
  }
}

export async function clickSelector(selector: string): Promise<string> {
  try {
    if (!activePage) throw new Error("No active browser.");
    await activePage.click(selector, { timeout: 5000 });
    return `Clicked: ${selector}`;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("clickSelector failed", err);
    return `Click failed for selector ${selector}: ${errorMsg}`;
  }
}

export async function rightClick(x: number, y: number): Promise<string> {
  try {
    if (!activePage) throw new Error("No active browser.");
    await activePage.mouse.click(x, y, { button: "right" });
    return `Right clicked at (${x}, ${y})`;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("rightClick failed", err);
    return `Right click failed: ${errorMsg}`;
  }
}

export async function scrollPage(direction: "up" | "down", amount: number = 300): Promise<string> {
  try {
    if (!activePage) throw new Error("No active browser.");
    await activePage.mouse.wheel(0, direction === "down" ? amount : -amount);
    return `Scrolled ${direction} by ${amount}px`;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("scrollPage failed", err);
    return `Scroll failed: ${errorMsg}`;
  }
}

export async function hoverAt(selector: string): Promise<string> {
  try {
    if (!activePage) throw new Error("No active browser.");
    await activePage.hover(selector);
    return `Hovered over: ${selector}`;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("hoverAt failed", err);
    return `Hover failed for ${selector}: ${errorMsg}`;
  }
}

// Keyboard Control
export async function typeText(text: string, selector?: string): Promise<string> {
  try {
    if (!activePage) throw new Error("No active browser.");
    if (selector) {
      await activePage.click(selector);
    }
    await activePage.keyboard.type(text, { delay: 50 });
    return `Typed: "${text}"`;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("typeText failed", err);
    return `Typing failed: ${errorMsg}`;
  }
}

export async function pressKey(key: string): Promise<string> {
  try {
    if (!activePage) throw new Error("No active browser.");
    await activePage.keyboard.press(key);
    return `Pressed key: ${key}`;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("pressKey failed", err);
    return `Key press failed for ${key}: ${errorMsg}`;
  }
}

export async function keyboardShortcut(shortcut: string): Promise<string> {
  try {
    if (!activePage) throw new Error("No active browser.");
    await activePage.keyboard.press(shortcut);
    return `Shortcut pressed: ${shortcut}`;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("keyboardShortcut failed", err);
    return `Shortcut failed for ${shortcut}: ${errorMsg}`;
  }
}

// Screen Reading
export async function getPageText(): Promise<string> {
  try {
    if (!activePage) throw new Error("No active browser.");
    const text = await activePage.evaluate(() => document.body.innerText);
    return text.slice(0, 3000);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("getPageText failed", err);
    return `Reading page text failed: ${errorMsg}`;
  }
}

export async function getPageTitle(): Promise<string> {
  try {
    if (!activePage) throw new Error("No active browser.");
    return await activePage.title();
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("getPageTitle failed", err);
    return `Reading page title failed: ${errorMsg}`;
  }
}

export async function findElement(selector: string): Promise<string> {
  try {
    if (!activePage) throw new Error("No active browser.");
    const el = await activePage.$(selector);
    if (!el) return `Element not found: ${selector}`;
    const text = await el.textContent();
    return `Found: ${text?.slice(0, 200)}`;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("findElement failed", err);
    return `Find element failed for ${selector}: ${errorMsg}`;
  }
}

export async function takeScreenshotOfPage(): Promise<string> {
  try {
    if (!activePage) throw new Error("No active browser.");
    const path = `./screenshot_${Date.now()}.png`;
    await activePage.screenshot({ path, fullPage: false });
    return `Screenshot saved: ${path}`;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("takeScreenshotOfPage failed", err);
    return `Screenshot failed: ${errorMsg}`;
  }
}

// Smart Actions
export async function searchOnPage(searchText: string): Promise<string> {
  try {
    if (!activePage) throw new Error("No active browser.");
    await activePage.keyboard.press("Control+f");
    await activePage.keyboard.type(searchText);
    return `Searching for: ${searchText}`;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("searchOnPage failed", err);
    return `Search failed for ${searchText}: ${errorMsg}`;
  }
}

export async function fillForm(selector: string, value: string): Promise<string> {
  try {
    if (!activePage) throw new Error("No active browser.");
    await activePage.fill(selector, value);
    return `Filled form field ${selector} with: ${value}`;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("fillForm failed", err);
    return `Fill form failed for ${selector}: ${errorMsg}`;
  }
}

export async function selectDropdown(selector: string, value: string): Promise<string> {
  try {
    if (!activePage) throw new Error("No active browser.");
    await activePage.selectOption(selector, value);
    return `Selected: ${value}`;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("selectDropdown failed", err);
    return `Select dropdown failed for ${selector}: ${errorMsg}`;
  }
}

export async function waitForElement(selector: string, timeout: number = 5000): Promise<string> {
  try {
    if (!activePage) throw new Error("No active browser.");
    await activePage.waitForSelector(selector, { timeout });
    return `Element found: ${selector}`;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("waitForElement failed", err);
    return `Wait for element failed for ${selector}: ${errorMsg}`;
  }
}

// YouTube Specific
export async function playYouTube(query: string): Promise<string> {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  console.log("[LAUNCH TRACE]", "src/tools/laptop/computer.ts", "playYouTube", searchUrl);
  await openUrlInBrowser(searchUrl);
  return `YouTube opened with search: ${query}`;
}
