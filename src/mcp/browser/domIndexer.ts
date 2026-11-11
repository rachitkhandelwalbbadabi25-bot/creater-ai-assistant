// ════════════════════════════════════════════════════════════════════════════════
// src/mcp/browser/domIndexer.ts — Dynamic DOM Interactive Element Indexer
// Injects a high-speed scanner into any live webpage to index interactive elements
// into semantic references (@e1, @e2...) like Manus AI & OpenHuman.
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
}

export interface DomSnapshot {
  url: string;
  title: string;
  elements: IndexedElement[];
  formattedTree: string;
}

/**
 * Injects a fast in-page DOM scanner that assigns data-creater-ref="e{index}"
 * to visible interactive elements and returns a compact semantic representation.
 */
export async function indexInteractiveElements(page: Page, maxElements: number = 60): Promise<DomSnapshot> {
  const url = page.url();
  const title = await page.title().catch(() => "");

  const rawElements: IndexedElement[] = await page.evaluate((maxCount) => {
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
      "[role='checkbox']",
      "[role='menuitem']",
      "[role='tab']",
      "[role='option']",
      "[contenteditable='true']",
      "[tabindex]:not([tabindex='-1'])",
    ].join(", ");

    const candidates = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
    const results: any[] = [];
    let count = 0;

    for (const el of candidates) {
      if (count >= maxCount) break;

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

      // Truncate long text to save LLM tokens
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
  }, maxElements).catch(() => []);

  // Format compact element list for LLM context
  const lines = rawElements.map((el) => {
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
    elements: rawElements,
    formattedTree,
  };
}

