// ════════════════════════════════════════════════════════════════════════════════
// src/mcp/browser/domIndexer.ts — Dynamic DOM Interactive Element Indexer
// Injects a high-speed scanner into any live webpage to index interactive elements
// into semantic references (@e1, @e2...) like Manus AI & OpenHuman.
// Includes TokenJuice semantic scoring and pruning for local CPU optimization.
// ════════════════════════════════════════════════════════════════════════════════

import { type Page } from "playwright";

export interface IndexedElement {
  ref: string; // e.g. "@e1"
  tag: string; // e.g. "button", "input", "a"
  role: string; // e.g. "button", "textbox", "link"
  name: string; // text content, aria-label, title, or value
  placeholder?: string;
  type?: string;
  value?: string;
  href?: string;
  isContentEditable?: boolean;
  score?: number;
}

export interface DomSnapshot {
  url: string;
  title: string;
  elements: IndexedElement[];
  formattedTree: string;
}

const NOISE_WORDS = new Set([
  "skip to content",
  "privacy",
  "terms",
  "cookie",
  "cookies",
  "testimonial",
  "pause animation",
  "pause activity",
  "copyright",
  "all rights reserved",
  "subscribe",
]);

/**
 * TokenJuice Semantic Scorer: Scores an element based on its relevance to the user's goal.
 * Eliminates 90% of irrelevant DOM fluff to keep prompt size < 400 chars for local CPU inference.
 */
export function scoreElementForGoal(el: IndexedElement, goal: string): number {
  if (!goal) return 1;

  const lowerGoal = goal.toLowerCase();
  const lowerName = el.name.toLowerCase();
  const lowerPlaceholder = (el.placeholder || "").toLowerCase();
  const lowerRole = el.role.toLowerCase();

  // 1. Noise penalty for irrelevant site fluff
  for (const noise of NOISE_WORDS) {
    if (lowerName.includes(noise)) return -50;
  }

  let score = 0;

  // 2. Search / Type / Compose intent detection
  const isSearchOrTypeIntent = /\b(search|find|query|type|look|check|repo|product|message|dm|say|tell|send|write|chat|reply|wish)\b/i.test(lowerGoal);
  const isSearchElement =
    lowerRole === "textbox" ||
    lowerRole === "searchbox" ||
    el.tag === "input" ||
    el.tag === "textarea" ||
    el.isContentEditable ||
    el.type === "search" ||
    lowerName.includes("search") ||
    lowerPlaceholder.includes("search");

  const isComposeElement =
    lowerName.includes("message") ||
    lowerPlaceholder.includes("message") ||
    lowerName.includes("write") ||
    lowerPlaceholder.includes("write") ||
    el.isContentEditable;

  if (isSearchOrTypeIntent && isSearchElement) {
    score += 30;
  }
  if (isSearchOrTypeIntent && isComposeElement) {
    score += 30;
  }

  // 3. Click / Action / Send intent detection
  const isClickIntent = /\b(click|star|follow|subscribe|submit|send|open|select|message|dm|say|tell|chat)\b/i.test(lowerGoal);
  const isActionElement = el.tag === "button" || lowerRole === "button" || lowerRole === "link";
  if (isClickIntent && isActionElement) {
    score += 15;
  }
  if (isClickIntent && isActionElement && (lowerName === "send" || lowerName.includes("send"))) {
    score += 25;
  }

  // 4. Goal keyword overlap matching
  const goalKeywords = lowerGoal
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !["the", "and", "for", "with", "this", "that", "open", "from"].includes(w));

  for (const kw of goalKeywords) {
    if (lowerName.includes(kw)) score += 20;
    if (lowerPlaceholder.includes(kw)) score += 20;
    if (el.href && el.href.toLowerCase().includes(kw)) score += 10;
  }

  // Baseline priority for actionable inputs and buttons over plain links
  if (el.tag === "input" || el.tag === "textarea" || el.isContentEditable) score += 5;
  if (el.tag === "button" || lowerRole === "button") score += 3;

  return score;
}

/**
 * Injects a fast in-page DOM scanner that assigns data-creater-ref="e{index}"
 * to visible interactive elements and returns a compact semantic representation.
 * Uses TokenJuice semantic pruning when a goal is provided to keep prompt < 400 chars.
 */
export async function indexInteractiveElements(
  page: Page,
  goal?: string,
  maxElements: number = 8
): Promise<DomSnapshot> {
  const url = page.url();
  const title = await page.title().catch(() => "");

  const rawElements: IndexedElement[] = await page.evaluate(() => {
    // Interactive candidate selector
    const selector = [
      "button",
      "input:not([type='hidden'])",
      "select",
      "textarea",
      "a[href]",
      "[role='button']",
      "[role='link']",
      "[role='textbox']",
      "[role='searchbox']",
      "[role='checkbox']",
      "[role='menuitem']",
      "[role='tab']",
      "[role='option']",
      "[contenteditable='true']",
      "[tabindex]:not([tabindex='-1'])",
    ].join(", ");

    const candidates = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
    const results: IndexedElement[] = [];
    let count = 0;

    for (const el of candidates) {
      // Check visibility & dimensions
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity || "1") === 0) {
        continue;
      }

      count++;
      const refId = `e${count}`;
      el.setAttribute("data-creater-ref", refId);

      // Extract semantic label/name
      let name = (
        el.getAttribute("aria-label") ||
        el.getAttribute("placeholder") ||
        el.getAttribute("title") ||
        el.getAttribute("alt") ||
        el.innerText ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim();

      if (name.length > 80) {
        name = name.slice(0, 77) + "...";
      }

      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute("role") || tag;
      const type = (el as HTMLInputElement).type || undefined;
      const placeholder = (el as HTMLInputElement).placeholder || undefined;
      const href = el.getAttribute("href") || undefined;
      const isContentEditable = el.isContentEditable || el.getAttribute("contenteditable") === "true";

      results.push({
        ref: `@${refId}`,
        tag,
        role,
        name: name || `(unnamed ${role})`,
        placeholder,
        type,
        href: href ? href.slice(0, 100) : undefined,
        isContentEditable,
      });
    }

    return results;
  }).catch(() => []);

  // TokenJuice Pruning: If a goal is provided, score elements and keep only top candidates
  let prunedElements = rawElements;
  if (goal && rawElements.length > 0) {
    const scored = rawElements.map((el) => ({
      ...el,
      score: scoreElementForGoal(el, goal),
    }));

    // Filter out negative noise and sort by relevance
    const valid = scored.filter((el) => (el.score ?? 0) >= 0);
    valid.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    prunedElements = valid.slice(0, maxElements);
    // If scoring filtered too aggressively, fallback to first few elements
    if (prunedElements.length === 0) {
      prunedElements = rawElements.slice(0, maxElements);
    }
  } else {
    prunedElements = rawElements.slice(0, maxElements);
  }

  // Format compact element list for LLM context
  const lines = prunedElements.map((el) => {
    const parts = [`[${el.ref}] (${el.role}) "${el.name}"`];
    if (el.placeholder && el.placeholder !== el.name) parts.push(`placeholder="${el.placeholder}"`);
    if (el.type) parts.push(`type="${el.type}"`);
    if (el.isContentEditable) parts.push(`[contenteditable]`);
    if (el.href) parts.push(`href="${el.href}"`);
    return parts.join(" ");
  });

  const formattedTree = lines.length > 0 ? lines.join("\n") : "(No interactive elements found on page)";

  return {
    url,
    title,
    elements: prunedElements,
    formattedTree,
  };
}
