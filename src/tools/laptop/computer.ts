import { chromium, type Browser, type Page } from "playwright";
import { createLogger } from "@utils/logger.js";

const log = createLogger("tools/computer");

let activeBrowser: Browser | null = null;
let activePage: Page | null = null;

// ── Browser Management ──────────────────────────────────────────
export async function openBrowser(url?: string): Promise<string> {
  activeBrowser = await chromium.launch({ 
    headless: false,
    args: ['--start-maximized']
  });
  const context = await activeBrowser.newContext({ viewport: null });
  activePage = await context.newPage();
  if (url) {
    await activePage.goto(url, { waitUntil: "domcontentloaded" });
    return `Browser opened at: ${url}`;
  }
  return "Browser opened";
}

export async function navigateTo(url: string): Promise<string> {
  if (!activePage) await openBrowser(url);
  else await activePage.goto(url, { waitUntil: "domcontentloaded" });
  const title = await activePage!.title();
  return `Navigated to: ${title}`;
}

export async function closeBrowserWindow(): Promise<string> {
  if (activeBrowser) {
    await activeBrowser.close();
    activeBrowser = null;
    activePage = null;
  }
  return "Browser closed";
}

// ── Mouse Control ───────────────────────────────────────────────
export async function clickAt(x: number, y: number): Promise<string> {
  if (!activePage) throw new Error("No active browser. Open a browser first.");
  await activePage.mouse.click(x, y);
  return `Clicked at (${x}, ${y})`;
}

export async function clickSelector(selector: string): Promise<string> {
  if (!activePage) throw new Error("No active browser.");
  await activePage.click(selector, { timeout: 5000 });
  return `Clicked: ${selector}`;
}

export async function rightClick(x: number, y: number): Promise<string> {
  if (!activePage) throw new Error("No active browser.");
  await activePage.mouse.click(x, y, { button: "right" });
  return `Right clicked at (${x}, ${y})`;
}

export async function scrollPage(direction: "up" | "down", amount: number = 300): Promise<string> {
  if (!activePage) throw new Error("No active browser.");
  await activePage.mouse.wheel(0, direction === "down" ? amount : -amount);
  return `Scrolled ${direction} by ${amount}px`;
}

export async function hoverAt(selector: string): Promise<string> {
  if (!activePage) throw new Error("No active browser.");
  await activePage.hover(selector);
  return `Hovered over: ${selector}`;
}

// ── Keyboard Control ────────────────────────────────────────────
export async function typeText(text: string, selector?: string): Promise<string> {
  if (!activePage) throw new Error("No active browser.");
  if (selector) {
    await activePage.click(selector);
  }
  await activePage.keyboard.type(text, { delay: 50 });
  return `Typed: "${text}"`;
}

export async function pressKey(key: string): Promise<string> {
  if (!activePage) throw new Error("No active browser.");
  await activePage.keyboard.press(key);
  return `Pressed key: ${key}`;
}

export async function keyboardShortcut(shortcut: string): Promise<string> {
  if (!activePage) throw new Error("No active browser.");
  await activePage.keyboard.press(shortcut);
  return `Shortcut pressed: ${shortcut}`;
}

// ── Screen Reading ───────────────────────────────────────────────
export async function getPageText(): Promise<string> {
  if (!activePage) throw new Error("No active browser.");
  const text = await activePage.evaluate(() => document.body.innerText);
  return text.slice(0, 3000);
}

export async function getPageTitle(): Promise<string> {
  if (!activePage) throw new Error("No active browser.");
  return await activePage.title();
}

export async function findElement(selector: string): Promise<string> {
  if (!activePage) throw new Error("No active browser.");
  const el = await activePage.$(selector);
  if (!el) return `Element not found: ${selector}`;
  const text = await el.textContent();
  return `Found: ${text?.slice(0, 200)}`;
}

export async function takeScreenshotOfPage(): Promise<string> {
  if (!activePage) throw new Error("No active browser.");
  const path = `./screenshot_${Date.now()}.png`;
  await activePage.screenshot({ path, fullPage: false });
  return `Screenshot saved: ${path}`;
}

// ── Smart Actions ────────────────────────────────────────────────
export async function searchOnPage(searchText: string): Promise<string> {
  if (!activePage) throw new Error("No active browser.");
  // Ctrl+F to open browser search
  await activePage.keyboard.press("Control+f");
  await activePage.keyboard.type(searchText);
  return `Searching for: ${searchText}`;
}

export async function fillForm(selector: string, value: string): Promise<string> {
  if (!activePage) throw new Error("No active browser.");
  await activePage.fill(selector, value);
  return `Filled form field ${selector} with: ${value}`;
}

export async function selectDropdown(selector: string, value: string): Promise<string> {
  if (!activePage) throw new Error("No active browser.");
  await activePage.selectOption(selector, value);
  return `Selected: ${value}`;
}

export async function waitForElement(selector: string, timeout: number = 5000): Promise<string> {
  if (!activePage) throw new Error("No active browser.");
  await activePage.waitForSelector(selector, { timeout });
  return `Element found: ${selector}`;
}

// ── YouTube Specific ─────────────────────────────────────────────
export async function playYouTube(query: string): Promise<string> {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  await navigateTo(searchUrl);
  
  try {
    await activePage!.waitForSelector('ytd-video-renderer', { timeout: 10000 });
    const firstVideo = await activePage!.$('ytd-video-renderer a#video-title');
    if (firstVideo) {
      await firstVideo.click();
      await activePage!.waitForTimeout(3000);
      return `Playing: ${query} on YouTube`;
    }
  } catch { }
  
  return `YouTube search opened for: ${query}`;
}
