// ════════════════════════════════════════════════════════════════════════════════
// src/cua/cuaVerifier.ts — Post-Action Verification Engine (Phase 5 Step 5)
// Observes resulting interface state and compares against expected outcomes.
// ════════════════════════════════════════════════════════════════════════════════

import * as fs from "fs";
import { createLogger } from "@utils/logger.js";
import { browserSessionManager } from "../mcp/browser/sessionManager.js";
import { captureBrowserViewport } from "./screenAnalyzer.js";

const log = createLogger("cua/verifier");

export type VerificationStatus = "VERIFIED" | "NOT_VERIFIED" | "VERIFICATION_UNAVAILABLE";

export type VerificationMethod =
  | "url_match"
  | "title_match"
  | "element_present"
  | "element_absent"
  | "text_present"
  | "text_absent"
  | "visual_change"
  | "desktop_window_match"
  | "desktop_text_present"
  | "file_exists";

export interface ExpectedOutcome {
  type: VerificationMethod;
  target?: string | RegExp;
  selector?: string;
  text?: string;
  filePath?: string;
  windowHint?: string;
  siteHint?: string;
  baselineScreenshotPath?: string;
  timeoutMs?: number;
}

export interface VerificationResult {
  status: VerificationStatus;
  success: boolean;
  method: VerificationMethod;
  confidence: number; // 1.0 for deterministic DOM/URL checks, 0.85 for visual heuristics
  expected: string;
  observed: string;
  reason: string;
  timestamp: number;
}

/**
 * Verifies post-action interface state against an ExpectedOutcome.
 * Performs ONLY passive observation — executes NO mouse clicks, key presses, or retries.
 */
export async function verifyCuaAction(
  outcome: ExpectedOutcome,
  tabId?: string
): Promise<VerificationResult> {
  const timestamp = Date.now();
  log.info(`Executing verification method '${outcome.type}'...`);

  // Guard against invalid outcome specification
  if (!outcome || !outcome.type) {
    return {
      status: "VERIFICATION_UNAVAILABLE",
      success: false,
      method: outcome?.type || "url_match",
      confidence: 0,
      expected: "Valid outcome specification",
      observed: "Invalid outcome object provided",
      reason: "Verification parameters are missing or invalid.",
      timestamp,
    };
  }

  try {
    switch (outcome.type) {
      // 1. URL Match Verification
      case "url_match": {
        const expectedPattern = outcome.target;
        if (!expectedPattern) {
          return createUnavailableResult(outcome.type, "Expected URL pattern specified", "Missing target", timestamp);
        }

        const observedUrl = await browserSessionManager.executeOnPage(async (page) => page.url(), tabId);
        const matches = checkPatternMatch(observedUrl, expectedPattern);

        return {
          status: matches ? "VERIFIED" : "NOT_VERIFIED",
          success: matches,
          method: "url_match",
          confidence: 1.0,
          expected: String(expectedPattern),
          observed: observedUrl,
          reason: matches
            ? `URL successfully matched pattern: '${expectedPattern}'`
            : `URL mismatch: Expected '${expectedPattern}', observed '${observedUrl}'`,
          timestamp,
        };
      }

      // 2. Title Match Verification
      case "title_match": {
        const expectedPattern = outcome.target;
        if (!expectedPattern) {
          return createUnavailableResult(outcome.type, "Expected title pattern specified", "Missing target", timestamp);
        }

        const observedTitle = await browserSessionManager.executeOnPage(async (page) => page.title(), tabId);
        const matches = checkPatternMatch(observedTitle, expectedPattern);

        return {
          status: matches ? "VERIFIED" : "NOT_VERIFIED",
          success: matches,
          method: "title_match",
          confidence: 1.0,
          expected: String(expectedPattern),
          observed: observedTitle,
          reason: matches
            ? `Page title successfully matched pattern: '${expectedPattern}'`
            : `Title mismatch: Expected '${expectedPattern}', observed '${observedTitle}'`,
          timestamp,
        };
      }

      // 3. Element Presence Verification
      case "element_present": {
        const selector = outcome.selector;
        if (!selector) {
          return createUnavailableResult(outcome.type, "CSS selector specified", "Missing selector", timestamp);
        }

        const present = await browserSessionManager.executeOnPage(async (page) => {
          const el = await page.$(selector);
          return el !== null;
        }, tabId);

        return {
          status: present ? "VERIFIED" : "NOT_VERIFIED",
          success: present,
          method: "element_present",
          confidence: 1.0,
          expected: `Element '${selector}' present in DOM`,
          observed: present ? `Element '${selector}' found` : `Element '${selector}' not found`,
          reason: present
            ? `DOM element '${selector}' exists on page.`
            : `DOM element '${selector}' was not found on page.`,
          timestamp,
        };
      }

      // 4. Element Absence Verification
      case "element_absent": {
        const selector = outcome.selector;
        if (!selector) {
          return createUnavailableResult(outcome.type, "CSS selector specified", "Missing selector", timestamp);
        }

        const absent = await browserSessionManager.executeOnPage(async (page) => {
          const el = await page.$(selector);
          return el === null;
        }, tabId);

        return {
          status: absent ? "VERIFIED" : "NOT_VERIFIED",
          success: absent,
          method: "element_absent",
          confidence: 1.0,
          expected: `Element '${selector}' absent from DOM`,
          observed: absent ? `Element '${selector}' absent` : `Element '${selector}' still present`,
          reason: absent
            ? `DOM element '${selector}' is absent as expected.`
            : `DOM element '${selector}' is still present in DOM.`,
          timestamp,
        };
      }

      // 5. Text Presence Verification
      case "text_present": {
        const targetText = outcome.text;
        if (!targetText) {
          return createUnavailableResult(outcome.type, "Target text specified", "Missing text parameter", timestamp);
        }

        const textFound = await browserSessionManager.executeOnPage(async (page) => {
          const bodyText = await page.evaluate(() => document.body.innerText || "");
          return bodyText.includes(targetText);
        }, tabId);

        return {
          status: textFound ? "VERIFIED" : "NOT_VERIFIED",
          success: textFound,
          method: "text_present",
          confidence: 1.0,
          expected: `Text "${targetText}" present on page`,
          observed: textFound ? `Text "${targetText}" found` : `Text "${targetText}" not found`,
          reason: textFound
            ? `Page content contains text "${targetText}".`
            : `Page content does not contain text "${targetText}".`,
          timestamp,
        };
      }

      // 6. Text Absence Verification
      case "text_absent": {
        const targetText = outcome.text;
        if (!targetText) {
          return createUnavailableResult(outcome.type, "Target text specified", "Missing text parameter", timestamp);
        }

        const textAbsent = await browserSessionManager.executeOnPage(async (page) => {
          const bodyText = await page.evaluate(() => document.body.innerText || "");
          return !bodyText.includes(targetText);
        }, tabId);

        return {
          status: textAbsent ? "VERIFIED" : "NOT_VERIFIED",
          success: textAbsent,
          method: "text_absent",
          confidence: 1.0,
          expected: `Text "${targetText}" absent from page`,
          observed: textAbsent ? `Text "${targetText}" absent` : `Text "${targetText}" still present`,
          reason: textAbsent
            ? `Page content does not contain text "${targetText}" as expected.`
            : `Page content still contains text "${targetText}".`,
          timestamp,
        };
      }

      // 7. Visual State Comparison Verification
      case "visual_change": {
        const baselinePath = outcome.baselineScreenshotPath;
        if (!baselinePath || !fs.existsSync(baselinePath)) {
          return createUnavailableResult(
            outcome.type,
            "Valid baseline screenshot file path",
            baselinePath ? `File not found: ${baselinePath}` : "Missing baseline path",
            timestamp
          );
        }

        const currentScreen = await captureBrowserViewport(undefined, tabId);
        if (!currentScreen.success) {
          return createUnavailableResult(
            outcome.type,
            "Current viewport captured",
            currentScreen.error.message,
            timestamp
          );
        }

        const baselineStat = fs.statSync(baselinePath);
        const currentStat = fs.statSync(currentScreen.metadata.filePath);

        // Visual delta calculation using file size / byte differences
        const byteDiff = Math.abs(baselineStat.size - currentStat.size);
        const stateChanged = byteDiff > 50; // Meaningful visual change threshold

        // Cleanup temporary current screenshot
        if (fs.existsSync(currentScreen.metadata.filePath)) {
          fs.unlinkSync(currentScreen.metadata.filePath);
        }

        return {
          status: stateChanged ? "VERIFIED" : "NOT_VERIFIED",
          success: stateChanged,
          method: "visual_change",
          confidence: 0.85, // Visual state heuristic confidence score
          expected: "Visual state difference > 50 bytes delta",
          observed: `Byte difference delta: ${byteDiff} bytes`,
          reason: stateChanged
            ? `Visual state changed meaningfully (byte delta: ${byteDiff}).`
            : `No visual state change detected (byte delta: ${byteDiff}).`,
          timestamp,
        };
      }

      // 8. Desktop Window Title Match Verification
      case "desktop_window_match": {
        const expectedPattern = outcome.target;
        if (!expectedPattern) {
          return createUnavailableResult(outcome.type, "Expected window title pattern", "Missing target", timestamp);
        }
        const { getActiveDesktopWindow, focusDesktopWindow } = await import("../tools/laptop/desktopControl.js");
        let observedTitle = "";
        if (outcome.windowHint) {
          const focused = await focusDesktopWindow(outcome.windowHint, outcome.siteHint);
          observedTitle = focused.title || "";
        } else {
          const active = await getActiveDesktopWindow();
          observedTitle = active.title || "";
        }
        const matches = checkPatternMatch(observedTitle, expectedPattern);
        return {
          status: matches ? "VERIFIED" : "NOT_VERIFIED",
          success: matches,
          method: "desktop_window_match",
          confidence: 1.0,
          expected: String(expectedPattern),
          observed: observedTitle,
          reason: matches
            ? `Desktop window title matched '${expectedPattern}'`
            : `Desktop window title mismatch: expected '${expectedPattern}', observed '${observedTitle}'`,
          timestamp,
        };
      }

      // 9. Desktop Surface Text Presence Verification (UIA + WinRT OCR)
      case "desktop_text_present": {
        const targetText = outcome.text;
        if (!targetText) {
          return createUnavailableResult(outcome.type, "Expected text on desktop surface", "Missing text", timestamp);
        }
        const { inspectDesktopBrowserSurface } = await import("../tools/laptop/desktopControl.js");
        const surface = await inspectDesktopBrowserSurface(outcome.windowHint || "chrome", outcome.siteHint);
        const combinedText = [
          surface.title || "",
          ...(surface.elements || []).map((e) => `${e.name || ""} ${e.text || ""}`),
        ]
          .join(" ")
          .toLowerCase();
        const found = combinedText.includes(targetText.toLowerCase());
        return {
          status: found ? "VERIFIED" : "NOT_VERIFIED",
          success: found,
          method: "desktop_text_present",
          confidence: 0.95,
          expected: `Desktop surface contains "${targetText}"`,
          observed: found ? `Found "${targetText}" on surface '${surface.title || ""}'` : `Not found on '${surface.title || ""}'`,
          reason: found
            ? `Verified "${targetText}" present on desktop surface via UIA/OCR.`
            : `Could not find "${targetText}" on desktop surface.`,
          timestamp,
        };
      }

      // 10. Local File Existence & Content Verification
      case "file_exists": {
        const filePath = outcome.filePath || (typeof outcome.target === "string" ? outcome.target : "");
        if (!filePath) {
          return createUnavailableResult(outcome.type, "Valid filePath specified", "Missing filePath", timestamp);
        }
        const exists = fs.existsSync(filePath);
        if (!exists) {
          return {
            status: "NOT_VERIFIED",
            success: false,
            method: "file_exists",
            confidence: 1.0,
            expected: `File exists at '${filePath}'`,
            observed: "File does not exist",
            reason: `File '${filePath}' was not found on disk.`,
            timestamp,
          };
        }
        if (outcome.text) {
          const content = fs.readFileSync(filePath, "utf8");
          const hasText = content.includes(outcome.text);
          return {
            status: hasText ? "VERIFIED" : "NOT_VERIFIED",
            success: hasText,
            method: "file_exists",
            confidence: 1.0,
            expected: `File '${filePath}' contains "${outcome.text}"`,
            observed: hasText ? `File exists (${content.length} chars) and contains expected text` : `File exists (${content.length} chars) but text missing`,
            reason: hasText
              ? `Verified file '${filePath}' exists and contains expected content.`
              : `File '${filePath}' exists but did not match expected content.`,
            timestamp,
          };
        }
        return {
          status: "VERIFIED",
          success: true,
          method: "file_exists",
          confidence: 1.0,
          expected: `File exists at '${filePath}'`,
          observed: `File exists at '${filePath}'`,
          reason: `Verified file '${filePath}' exists on disk.`,
          timestamp,
        };
      }

      default:
        return createUnavailableResult(outcome.type, "Supported verification method", `Unknown method: ${outcome.type}`, timestamp);
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error(`Verification execution failed for method '${outcome.type}'`, { error: errMsg });
    return {
      status: "VERIFICATION_UNAVAILABLE",
      success: false,
      method: outcome.type,
      confidence: 0,
      expected: "Successful page verification inspection",
      observed: `Error: ${errMsg}`,
      reason: `Verification failed due to error: ${errMsg}`,
      timestamp,
    };
  }
}

/** Helper for string or RegExp matching */
function checkPatternMatch(value: string, pattern: string | RegExp): boolean {
  if (pattern instanceof RegExp) {
    return pattern.test(value);
  }
  return value.includes(pattern);
}

/** Helper for unavailable verification results */
function createUnavailableResult(
  method: VerificationMethod,
  expected: string,
  observed: string,
  timestamp: number
): VerificationResult {
  return {
    status: "VERIFICATION_UNAVAILABLE",
    success: false,
    method,
    confidence: 0,
    expected,
    observed,
    reason: `Verification unavailable: ${observed}`,
    timestamp,
  };
}
