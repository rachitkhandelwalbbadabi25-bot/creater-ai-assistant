// ════════════════════════════════════════════════════════════════════════════════
// src/mcp/browser/browserPrimitives.ts — Universal Browser Primitives
// Provides atomic execution of click, type, press, scroll, goto on Playwright pages
// targeting dynamic semantic references (@e1, @e2, etc.)
// ════════════════════════════════════════════════════════════════════════════════

import { type Page } from "playwright";
import { createLogger } from "@utils/logger.js";

const log = createLogger("mcp/browser/primitives");

export interface PrimitiveExecutionResult {
  success: boolean;
  action: string;
  target?: string;
  details: string;
  error?: string;
}

/**
 * Strips '@' symbol from ref if present (e.g. '@e1' -> 'e1')
 */
function cleanRef(ref: string): string {
  return ref.replace(/^@/, "").trim();
}

/**
 * Clicks a target element by its semantic ref (@e1) or CSS selector.
 */
export async function primitiveClick(page: Page, target: string): Promise<PrimitiveExecutionResult> {
  const ref = cleanRef(target);
  const selector = `[data-creater-ref="${ref}"]`;

  try {
    const el = await page.waitForSelector(selector, { timeout: 4000 });
    if (!el) {
      throw new Error(`Element ${target} not found on page`);
    }

    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.click({ timeout: 3000 });
    log.info(`[PRIMITIVE_CLICK_SUCCESS] target=${target}`);

    return {
      success: true,
      action: "click",
      target,
      details: `Clicked element [${target}].`,
    };
  } catch (err: any) {
    // Fallback: try direct text matching if ref lookup fails
    try {
      const textBtn = await page.waitForSelector(`text="${target}"`, { timeout: 1500 });
      if (textBtn) {
        await textBtn.click();
        return {
          success: true,
          action: "click",
          target,
          details: `Clicked element matching text "${target}".`,
        };
      }
    } catch {}

    log.warn(`[PRIMITIVE_CLICK_FAILED] target=${target}, error=${err.message}`);
    return {
      success: false,
      action: "click",
      target,
      details: `Failed to click ${target}: ${err.message}`,
      error: err.message,
    };
  }
}

/**
 * Types text into an element by its semantic ref (@e1).
 * Handles inputs, textareas, and rich contenteditable containers cleanly.
 */
export async function primitiveType(
  page: Page,
  target: string,
  text: string,
  pressEnter: boolean = false
): Promise<PrimitiveExecutionResult> {
  const ref = cleanRef(target);
  const selector = `[data-creater-ref="${ref}"]`;

  try {
    const el = await page.waitForSelector(selector, { timeout: 4000 });
    if (!el) {
      throw new Error(`Element ${target} not found on page`);
    }

    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.click().catch(() => {});

    const isContentEditable = await el.evaluate(
      (node) => (node as HTMLElement).isContentEditable || node.getAttribute("contenteditable") === "true"
    );

    if (isContentEditable) {
      // Focus and type via keyboard for rich-text editors (LinkedIn, Slack, Discord, Twitter)
      await el.focus();
      await page.keyboard.type(text, { delay: 30 });
    } else {
      // Standard input or textarea
      await (el as any).fill(text).catch(async () => {
        await el.focus();
        await page.keyboard.type(text, { delay: 30 });
      });
    }

    if (pressEnter) {
      await page.waitForTimeout(150);
      await page.keyboard.press("Enter");
    }

    log.info(`[PRIMITIVE_TYPE_SUCCESS] target=${target}, text="${text}", enter=${pressEnter}`);
    return {
      success: true,
      action: "type",
      target,
      details: `Typed "${text}" into [${target}]${pressEnter ? " and pressed Enter" : ""}.`,
    };
  } catch (err: any) {
    log.warn(`[PRIMITIVE_TYPE_FAILED] target=${target}, error=${err.message}`);
    return {
      success: false,
      action: "type",
      target,
      details: `Failed to type into ${target}: ${err.message}`,
      error: err.message,
    };
  }
}

/**
 * Presses a keyboard key on the active page (e.g. "Enter", "Escape", "Tab", "ArrowDown").
 */
export async function primitivePress(page: Page, key: string): Promise<PrimitiveExecutionResult> {
  try {
    await page.keyboard.press(key);
    log.info(`[PRIMITIVE_PRESS_SUCCESS] key=${key}`);
    return {
      success: true,
      action: "press",
      target: key,
      details: `Pressed key [${key}].`,
    };
  } catch (err: any) {
    log.warn(`[PRIMITIVE_PRESS_FAILED] key=${key}, error=${err.message}`);
    return {
      success: false,
      action: "press",
      target: key,
      details: `Failed to press key ${key}: ${err.message}`,
      error: err.message,
    };
  }
}

/**
 * Scrolls the page viewport up or down.
 */
export async function primitiveScroll(
  page: Page,
  direction: "up" | "down" = "down",
  amount: number = 400
): Promise<PrimitiveExecutionResult> {
  try {
    const deltaY = direction === "down" ? amount : -amount;
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(300);
    log.info(`[PRIMITIVE_SCROLL_SUCCESS] direction=${direction}, amount=${amount}`);
    return {
      success: true,
      action: "scroll",
      details: `Scrolled ${direction} by ${amount}px.`,
    };
  } catch (err: any) {
    log.warn(`[PRIMITIVE_SCROLL_FAILED] error=${err.message}`);
    return {
      success: false,
      action: "scroll",
      details: `Failed to scroll: ${err.message}`,
      error: err.message,
    };
  }
}

/**
 * Navigates the page to a specified URL.
 */
export async function primitiveGoto(page: Page, url: string): Promise<PrimitiveExecutionResult> {
  try {
    let targetUrl = url.trim();
    if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
      targetUrl = `https://${targetUrl}`;
    }

    log.info(`[PRIMITIVE_GOTO] Navigating to ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
    return {
      success: true,
      action: "goto",
      target: targetUrl,
      details: `Navigated to ${targetUrl}.`,
    };
  } catch (err: any) {
    log.warn(`[PRIMITIVE_GOTO_FAILED] url=${url}, error=${err.message}`);
    return {
      success: false,
      action: "goto",
      target: url,
      details: `Failed to navigate to ${url}: ${err.message}`,
      error: err.message,
    };
  }
}

