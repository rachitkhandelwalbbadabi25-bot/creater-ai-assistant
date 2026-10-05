// ════════════════════════════════════════════════════════════════════════════════
// src/cua/screenAnalyzer.ts — Passive Screen Inspection & Coordinate System (Phase 5 Step 3)
// Provides visual state acquisition across Desktop, Browser Viewport, and DOM Elements.
// ════════════════════════════════════════════════════════════════════════════════

import * as fs from "fs";
import * as path from "path";
import { createLogger } from "@utils/logger.js";
import { screenshot as desktopScreenshot } from "../mcp/os/osOps.js";
import { browserSessionManager } from "../mcp/browser/sessionManager.js";

const log = createLogger("cua/screenAnalyzer");

export type ScreenSourceType = "DESKTOP_SCREEN" | "BROWSER_VIEWPORT" | "BROWSER_ELEMENT";

/** Visual state metadata for captured screenshots */
export interface VisualStateMetadata {
  sourceType: ScreenSourceType;
  filePath: string;
  width: number;
  height: number;
  timestamp: number;
  mimeType: "image/png";
  devicePixelRatio?: number;
  bounds?: { x: number; y: number; width: number; height: number };
}

/** 1. Absolute desktop screen coordinates (X, Y in pixels relative to primary monitor top-left) */
export interface ScreenCoordinates {
  x: number;
  y: number;
}

/** 2. Browser window content viewport coordinates (vX, vY in pixels relative to browser content viewport top-left) */
export interface ViewportCoordinates {
  vx: number;
  vy: number;
}

/** 3. Full document page coordinates (pX, pY in pixels relative to page top-left, including scroll offsets) */
export interface PageCoordinates {
  px: number;
  py: number;
}

/** 4. Bounding box coordinates for a specific visual element or region */
export interface ElementCoordinates {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Screen inspection error structure */
export interface ScreenInspectionError {
  code: "CAPTURE_FAILED" | "ELEMENT_NOT_FOUND" | "UNSUPPORTED_SOURCE" | "FILE_READ_ERROR";
  message: string;
  sourceType: ScreenSourceType;
}

export type ScreenInspectionResult =
  | { success: true; metadata: VisualStateMetadata }
  | { success: false; error: ScreenInspectionError };

/**
 * Parses PNG header bytes to extract image dimensions (width & height in pixels) without external dependencies.
 */
export function getPngDimensions(filePath: string): { width: number; height: number } {
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(24);
    fs.readSync(fd, buffer, 0, 24, 0);

    // Verify PNG magic number: 0x89 'P' 'N' 'G' '\r' '\n' 0x1A '\n'
    if (
      buffer[0] !== 0x89 ||
      buffer[1] !== 0x50 ||
      buffer[2] !== 0x4e ||
      buffer[3] !== 0x47
    ) {
      throw new Error(`File '${filePath}' is not a valid PNG image.`);
    }

    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { width, height };
  } finally {
    fs.closeSync(fd);
  }
}

// ─── Coordinate Conversion Utilities ────────────────────────────────────────

/** Convert browser viewport coordinates to absolute desktop screen coordinates using window offset */
export function viewportToScreen(
  vp: ViewportCoordinates,
  windowOffset: { x: number; y: number }
): ScreenCoordinates {
  return {
    x: vp.vx + windowOffset.x,
    y: vp.vy + windowOffset.y,
  };
}

/** Convert absolute desktop screen coordinates to browser viewport coordinates using window offset */
export function screenToViewport(
  sc: ScreenCoordinates,
  windowOffset: { x: number; y: number }
): ViewportCoordinates {
  return {
    vx: sc.x - windowOffset.x,
    vy: sc.y - windowOffset.y,
  };
}

/** Convert browser viewport coordinates to document page coordinates using scroll offsets */
export function viewportToPage(
  vp: ViewportCoordinates,
  scroll: { scrollX: number; scrollY: number }
): PageCoordinates {
  return {
    px: vp.vx + scroll.scrollX,
    py: vp.vy + scroll.scrollY,
  };
}

/** Convert document page coordinates to browser viewport coordinates using scroll offsets */
export function pageToViewport(
  page: PageCoordinates,
  scroll: { scrollX: number; scrollY: number }
): ViewportCoordinates {
  return {
    vx: page.px - scroll.scrollX,
    vy: page.py - scroll.scrollY,
  };
}

// ─── Visual State Acquisition (Passive Inspection Only) ──────────────────────

/**
 * Capture full desktop screen state (Passive inspection only).
 * Reuses system OS screenshot capability in src/mcp/os/osOps.ts.
 */
export async function captureDesktopScreen(): Promise<ScreenInspectionResult> {
  log.info("Capturing desktop screen visual state...");
  try {
    const filePath = await desktopScreenshot();
    const dimensions = getPngDimensions(filePath);

    const metadata: VisualStateMetadata = {
      sourceType: "DESKTOP_SCREEN",
      filePath,
      width: dimensions.width,
      height: dimensions.height,
      timestamp: Date.now(),
      mimeType: "image/png",
    };

    return { success: true, metadata };
  } catch (err: any) {
    log.error("Failed to capture desktop screen visual state", { error: err.message });
    return {
      success: false,
      error: {
        code: "CAPTURE_FAILED",
        message: `Desktop screen capture failed: ${err.message}`,
        sourceType: "DESKTOP_SCREEN",
      },
    };
  }
}

/**
 * Capture browser content viewport state (Passive inspection only).
 * Reuses authoritative browserSessionManager in src/mcp/browser/sessionManager.ts.
 */
export async function captureBrowserViewport(
  savePath?: string,
  tabId?: string
): Promise<ScreenInspectionResult> {
  log.info("Capturing browser viewport visual state...");
  try {
    const targetDir = path.join(process.cwd(), "data", "checkpoints", "screenshots");
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const finalPath = savePath || path.join(targetDir, `viewport_${Date.now()}.png`);

    const pageMeta = await browserSessionManager.executeOnPage(async (page) => {
      await page.screenshot({ path: finalPath, fullPage: false });
      const viewport = page.viewportSize();
      const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio || 1);
      return { viewport, devicePixelRatio };
    }, tabId);

    const dimensions = getPngDimensions(finalPath);

    const metadata: VisualStateMetadata = {
      sourceType: "BROWSER_VIEWPORT",
      filePath: finalPath,
      width: dimensions.width || pageMeta.viewport?.width || 0,
      height: dimensions.height || pageMeta.viewport?.height || 0,
      timestamp: Date.now(),
      mimeType: "image/png",
      devicePixelRatio: pageMeta.devicePixelRatio,
    };

    return { success: true, metadata };
  } catch (err: any) {
    log.error("Failed to capture browser viewport visual state", { error: err.message });
    return {
      success: false,
      error: {
        code: "CAPTURE_FAILED",
        message: `Browser viewport capture failed: ${err.message}`,
        sourceType: "BROWSER_VIEWPORT",
      },
    };
  }
}

/**
 * Capture a specific DOM element screenshot (Passive inspection only).
 * Reuses authoritative browserSessionManager.
 */
export async function captureDomElement(
  selector: string,
  savePath?: string,
  tabId?: string
): Promise<ScreenInspectionResult> {
  log.info(`Capturing DOM element visual state for selector '${selector}'...`);
  try {
    const targetDir = path.join(process.cwd(), "data", "checkpoints", "screenshots");
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const finalPath = savePath || path.join(targetDir, `element_${Date.now()}.png`);

    const elemBounds = await browserSessionManager.executeOnPage(async (page) => {
      const el = await page.$(selector);
      if (!el) {
        throw new Error(`Selector '${selector}' not found on page`);
      }
      await el.screenshot({ path: finalPath });
      const box = await el.boundingBox();
      return box;
    }, tabId);

    const dimensions = getPngDimensions(finalPath);

    const metadata: VisualStateMetadata = {
      sourceType: "BROWSER_ELEMENT",
      filePath: finalPath,
      width: dimensions.width,
      height: dimensions.height,
      timestamp: Date.now(),
      mimeType: "image/png",
      bounds: elemBounds
        ? { x: elemBounds.x, y: elemBounds.y, width: elemBounds.width, height: elemBounds.height }
        : undefined,
    };

    return { success: true, metadata };
  } catch (err: any) {
    const isNotFound = err.message?.includes("not found");
    log.error("Failed to capture DOM element visual state", { error: err.message, selector });
    return {
      success: false,
      error: {
        code: isNotFound ? "ELEMENT_NOT_FOUND" : "CAPTURE_FAILED",
        message: `DOM element capture failed: ${err.message}`,
        sourceType: "BROWSER_ELEMENT",
      },
    };
  }
}
