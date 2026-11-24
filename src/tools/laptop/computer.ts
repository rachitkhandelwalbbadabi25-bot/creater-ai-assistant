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
const COMPUTER_POLICY = { maxAttempts: 2, baseDelayMs: 300, timeoutMs: 30000 };

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

interface ResolvedYouTubeVideo {
  url: string;
  title: string;
}

async function resolveYouTubeVideoViaFetch(query: string): Promise<ResolvedYouTubeVideo | null> {
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    clearTimeout(timer);

    if (!res.ok) return null;
    const html = await res.text();

    // 1. Try extracting structured video data from ytInitialData
    const jsonMatch = html.match(/var ytInitialData\s*=\s*(\{[\s\S]*?\});<\/script>/);
    if (jsonMatch && jsonMatch[1]) {
      try {
        const data = JSON.parse(jsonMatch[1]);
        const sections =
          data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
        if (Array.isArray(sections)) {
          for (const section of sections) {
            const items = section.itemSectionRenderer?.contents;
            if (Array.isArray(items)) {
              for (const item of items) {
                const vr = item.videoRenderer;
                if (vr && vr.videoId) {
                  const title =
                    vr.title?.runs?.map((r: { text?: string }) => r.text || "").join("") ||
                    vr.title?.simpleText ||
                    "";
                  return {
                    url: `https://www.youtube.com/watch?v=${vr.videoId}`,
                    title: title.trim(),
                  };
                }
              }
            }
          }
        }
      } catch {
        /* fallback to regex parsing */
      }
    }

    // 2. Fallback to direct regex search on watch links inside the raw HTML
    const videoIdMatch = html.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);
    if (videoIdMatch && videoIdMatch[1]) {
      return {
        url: `https://www.youtube.com/watch?v=${videoIdMatch[1]}`,
        title: query,
      };
    }
  } catch {
    /* ignore and fall through to Playwright or search URL fallback */
  }
  return null;
}

async function postYouTubeCommentIfRequested(
  comment: string | undefined,
  videoTitle: string,
  approved?: boolean
): Promise<string> {
  const cleanComment = comment?.trim();
  if (!cleanComment) return "";

  if (approved === false) {
    return ` (comment "${cleanComment}" cancelled: User rejected YouTube comment publication)`;
  }

  try {
    // Allow Chrome tab to finish loading the YouTube watch page DOM before scrolling to #comments
    await new Promise((r) => setTimeout(r, 3400));
    const { commentOnYouTubeDesktop } = await import("./desktopControl.js");
    const siteHint = videoTitle && videoTitle.length >= 4 ? videoTitle.slice(0, 24) : "YouTube";
    const commentRes = await commentOnYouTubeDesktop(cleanComment, siteHint, "chrome", { approved });

    if (commentRes?.status === "AWAITING_APPROVAL") {
      return ` (composed comment "${cleanComment}" — AWAITING_APPROVAL before publishing)`;
    }
    if (commentRes?.status === "SUCCESS" && commentRes?.verified === true) {
      return ` and commented "${cleanComment}"`;
    }
    if (commentRes?.status === "PARTIAL_SUCCESS") {
      log.warn("[YOUTUBE_COMMENT] Comment submitted, but post-publish thread verification was not confirmed", {
        error: commentRes?.error,
      });
      return ` (submitted comment "${cleanComment}" — PARTIAL_SUCCESS: post-publish thread verification unconfirmed)`;
    }
    log.warn("[YOUTUBE_COMMENT] Auto-comment did not complete", { error: commentRes?.error });
    return ` (could not auto-post comment "${cleanComment}": ${commentRes?.error || "comment box not ready"})`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("[YOUTUBE_COMMENT] Auto-comment failed", { error: msg });
    return ` (could not auto-post comment "${cleanComment}": ${msg})`;
  }
}

export async function playYouTube(
  query: string,
  action: "play" | "search" = "play",
  selection: "first" = "first",
  comment?: string,
  approved?: boolean
): Promise<string> {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  console.log("[LAUNCH TRACE]", "src/tools/laptop/computer.ts", "playYouTube", {
    query,
    action,
    selection,
    comment,
    approved,
    searchUrl,
  });

  if (action === "search" || !query.trim()) {
    await openUrl(searchUrl);
    return `Searched YouTube for "${query}".`;
  }

  // 1. Ultra-fast path: resolve the watch link directly in ~300ms without spinning up headless Chromium
  const fastVideo = await resolveYouTubeVideoViaFetch(query);
  if (fastVideo && fastVideo.url) {
    log.info(`[YOUTUBE_PLAY] Fast-resolved video watch URL: ${fastVideo.url} (${fastVideo.title})`);
    await openUrl(fastVideo.url);
    const videoTitle = fastVideo.title && fastVideo.title.length > 0 ? fastVideo.title : `first ${query} video`;
    const commentSuffix = await postYouTubeCommentIfRequested(comment, videoTitle, approved);
    return `Playing "${videoTitle}" on YouTube${commentSuffix}.`;
  }

  // 2. Playwright fallback: Use Playwright to find the watch link if lightweight fetch failed
  const playwrightResult = await withComputerAction("computer.playYouTube", async (page) => {
    log.info(`[YOUTUBE_PLAY] Opening search results page for "${query}" (action: ${action}, selection: ${selection}): ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Wait for video result links to load
    const selector = 'a#video-title, a[href*="/watch?v="]';
    try {
      await page.waitForSelector(selector, { timeout: 10000 });
    } catch {
      log.warn("No video selector found on YouTube search page");
    }

    // Inspect search results and find the first watch link
    const videoData = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/watch?v="]')) as HTMLAnchorElement[];
      for (const link of links) {
        const href = link.getAttribute("href");
        const rawTitle = link.getAttribute("title") || link.innerText?.trim() || "";
        const cleanTitle = rawTitle.split("\n")[0].trim();
        if (href && href.includes("/watch?v=")) {
          const fullUrl = href.startsWith("http") ? href : `https://www.youtube.com${href}`;
          return { url: fullUrl, title: cleanTitle };
        }
      }
      return null;
    });

    if (!videoData || !videoData.url) {
      throw new Error(`Could not find a video result on YouTube for "${query}".`);
    }

    log.info(`[YOUTUBE_PLAY] Found video watch URL: ${videoData.url} (${videoData.title})`);

    // Launch Chrome directly to the watch URL so user can watch & listen cleanly
    await openUrl(videoData.url);

    const videoTitle = videoData.title && videoData.title.length > 0 ? videoData.title : `first ${query} video`;
    const commentSuffix = await postYouTubeCommentIfRequested(comment, videoTitle, approved);
    return `Playing "${videoTitle}" on YouTube${commentSuffix}.`;
  });

  // 3. Graceful fallback: If Playwright resolution failed or timed out, open the search URL in the browser
  if (typeof playwrightResult === "string" && playwrightResult.includes("failed:")) {
    log.warn("[YOUTUBE_PLAY] Playwright resolution failed, opening search page directly", { result: playwrightResult });
    await openUrl(searchUrl);
    return `Searched YouTube for "${query}".`;
  }

  return playwrightResult;
}


