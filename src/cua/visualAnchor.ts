// ════════════════════════════════════════════════════════════════════════════════
// src/cua/visualAnchor.ts — Visual Anchor & Safe Coordinate Target Abstraction (Phase 5 Step 4)
// Provides target representation, coordinate mapping, and safe anchor validation.
// ════════════════════════════════════════════════════════════════════════════════

import { createLogger } from "@utils/logger.js";
import {
  viewportToScreen,
  screenToViewport,
  viewportToPage,
  pageToViewport,
  type ScreenCoordinates,
  type ViewportCoordinates,
  type PageCoordinates,
} from "./screenAnalyzer.js";

const log = createLogger("cua/visualAnchor");

export type AnchorType =
  | "text"
  | "image"
  | "icon"
  | "button"
  | "region"
  | "dom_element"
  | "template_match";

export type CoordinateSpace = "SCREEN" | "VIEWPORT" | "PAGE" | "ELEMENT";

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "DETERMINISTIC";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Visual Target / Anchor representation */
export interface VisualAnchor {
  id: string;
  type: AnchorType;
  bounds: BoundingBox;
  center: Point;
  confidence: number; // 0.0 to 1.0
  confidenceLevel: ConfidenceLevel;
  coordinateSpace: CoordinateSpace;
  source: string; // e.g., "playwright_dom", "ocr_detector", "manual_region", "template_matcher"
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface ScreenDimensionConstraints {
  width: number;
  height: number;
}

export interface AnchorValidationResult {
  valid: boolean;
  anchorId: string;
  errors: string[];
  warnings: string[];
  targetCenter?: Point;
  coordinateSpace?: CoordinateSpace;
}

export interface CreateVisualAnchorParams {
  id: string;
  type: AnchorType;
  bounds: BoundingBox;
  confidence?: number;
  coordinateSpace: CoordinateSpace;
  source: string;
  label?: string;
  metadata?: Record<string, unknown>;
}

/** Computes center point (x, y) of a bounding box */
export function calculateCenter(bounds: BoundingBox): Point {
  return {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  };
}

/** Maps numeric confidence [0..1] to qualitative confidence level */
export function getConfidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 1.0) return "DETERMINISTIC";
  if (confidence >= 0.8) return "HIGH";
  if (confidence >= 0.5) return "MEDIUM";
  return "LOW";
}

/**
 * Creates a structured VisualAnchor with calculated center and confidence level.
 */
export function createVisualAnchor(params: CreateVisualAnchorParams): VisualAnchor {
  const confidence = params.confidence ?? 1.0;
  const center = calculateCenter(params.bounds);
  const confidenceLevel = getConfidenceLevel(confidence);

  const anchor: VisualAnchor = {
    id: params.id,
    type: params.type,
    bounds: params.bounds,
    center,
    confidence,
    confidenceLevel,
    coordinateSpace: params.coordinateSpace,
    source: params.source,
    label: params.label,
    metadata: params.metadata,
  };

  log.info(`Created VisualAnchor [${anchor.id}] type=${anchor.type} space=${anchor.coordinateSpace}`);
  return anchor;
}

/**
 * Creates a VisualAnchor for a DOM element (deterministic confidence = 1.0).
 */
export function createDomElementAnchor(
  selector: string,
  bounds: BoundingBox,
  coordinateSpace: CoordinateSpace = "VIEWPORT"
): VisualAnchor {
  return createVisualAnchor({
    id: `dom_${selector}_${Date.now()}`,
    type: "dom_element",
    bounds,
    confidence: 1.0,
    coordinateSpace,
    source: "playwright_dom",
    label: selector,
  });
}

/**
 * Validates a VisualAnchor against geometric bounds, coordinate space, confidence thresholds, and screen constraints.
 * Fails safely if coordinates or bounds are invalid.
 */
export function validateVisualAnchor(
  anchor: VisualAnchor,
  screenConstraints?: ScreenDimensionConstraints
): AnchorValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Basic structural validity
  if (!anchor || typeof anchor !== "object") {
    return {
      valid: false,
      anchorId: "unknown",
      errors: ["Anchor instance is null or undefined"],
      warnings: [],
    };
  }

  if (!anchor.id || typeof anchor.id !== "string") {
    errors.push("Anchor missing valid id string.");
  }

  // 2. Validate Coordinate Space
  const validSpaces: CoordinateSpace[] = ["SCREEN", "VIEWPORT", "PAGE", "ELEMENT"];
  if (!validSpaces.includes(anchor.coordinateSpace)) {
    errors.push(`Unknown or unsupported coordinate space: '${anchor.coordinateSpace}'`);
  }

  // 3. Validate Bounds Geometry
  const { bounds } = anchor;
  if (!bounds || typeof bounds !== "object") {
    errors.push("Anchor missing bounds object.");
  } else {
    if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) {
      errors.push(`Invalid non-finite bounds origin: (${bounds.x}, ${bounds.y})`);
    }
    if (!Number.isFinite(bounds.width) || bounds.width <= 0) {
      errors.push(`Invalid bounds width: ${bounds.width}. Width must be > 0.`);
    }
    if (!Number.isFinite(bounds.height) || bounds.height <= 0) {
      errors.push(`Invalid bounds height: ${bounds.height}. Height must be > 0.`);
    }
  }

  // 4. Validate Center Point
  if (!anchor.center || !Number.isFinite(anchor.center.x) || !Number.isFinite(anchor.center.y)) {
    errors.push("Anchor center coordinates are missing or non-finite.");
  }

  // 5. Validate Confidence Range
  if (typeof anchor.confidence !== "number" || anchor.confidence < 0 || anchor.confidence > 1.0) {
    errors.push(`Confidence score out of range [0..1]: ${anchor.confidence}`);
  } else if (anchor.confidence < 0.5) {
    warnings.push(`Low confidence score (${anchor.confidence}) for anchor ${anchor.id}. Visual target may be inaccurate.`);
  }

  // 6. Validate against Screen/Viewport Constraints (Out-of-bounds check)
  if (screenConstraints && errors.length === 0) {
    const { width, height } = screenConstraints;

    if (
      bounds.x < 0 ||
      bounds.y < 0 ||
      bounds.x + bounds.width > width ||
      bounds.y + bounds.height > height
    ) {
      errors.push(
        `Anchor bounds [(${bounds.x}, ${bounds.y}), ${bounds.width}x${bounds.height}] exceed screen dimensions (${width}x${height}).`
      );
    }

    if (
      anchor.center.x < 0 ||
      anchor.center.x > width ||
      anchor.center.y < 0 ||
      anchor.center.y > height
    ) {
      errors.push(
        `Anchor center target (${anchor.center.x}, ${anchor.center.y}) lies outside screen bounds (${width}x${height}).`
      );
    }
  }

  const valid = errors.length === 0;

  if (!valid) {
    log.warn(`VisualAnchor [${anchor.id || "unknown"}] validation failed: ${errors.join("; ")}`);
  }

  return {
    valid,
    anchorId: anchor.id || "unknown",
    errors,
    warnings,
    targetCenter: valid ? anchor.center : undefined,
    coordinateSpace: valid ? anchor.coordinateSpace : undefined,
  };
}

/**
 * Converts a VisualAnchor's coordinate space to a target coordinate space using explicit conversions.
 * Returns a new VisualAnchor in the target space.
 */
export function convertAnchorCoordinateSpace(
  anchor: VisualAnchor,
  targetSpace: CoordinateSpace,
  context: {
    windowOffset?: { x: number; y: number };
    scroll?: { scrollX: number; scrollY: number };
  }
): VisualAnchor {
  if (anchor.coordinateSpace === targetSpace) {
    return { ...anchor };
  }

  let newX = anchor.bounds.x;
  let newY = anchor.bounds.y;

  // VIEWPORT -> SCREEN
  if (anchor.coordinateSpace === "VIEWPORT" && targetSpace === "SCREEN") {
    if (!context.windowOffset) {
      throw new Error("Conversion VIEWPORT -> SCREEN requires context.windowOffset");
    }
    const sc: ScreenCoordinates = viewportToScreen(
      { vx: anchor.bounds.x, vy: anchor.bounds.y },
      context.windowOffset
    );
    newX = sc.x;
    newY = sc.y;
  }
  // SCREEN -> VIEWPORT
  else if (anchor.coordinateSpace === "SCREEN" && targetSpace === "VIEWPORT") {
    if (!context.windowOffset) {
      throw new Error("Conversion SCREEN -> VIEWPORT requires context.windowOffset");
    }
    const vp: ViewportCoordinates = screenToViewport(
      { x: anchor.bounds.x, y: anchor.bounds.y },
      context.windowOffset
    );
    newX = vp.vx;
    newY = vp.vy;
  }
  // VIEWPORT -> PAGE
  else if (anchor.coordinateSpace === "VIEWPORT" && targetSpace === "PAGE") {
    if (!context.scroll) {
      throw new Error("Conversion VIEWPORT -> PAGE requires context.scroll");
    }
    const page: PageCoordinates = viewportToPage(
      { vx: anchor.bounds.x, vy: anchor.bounds.y },
      context.scroll
    );
    newX = page.px;
    newY = page.py;
  }
  // PAGE -> VIEWPORT
  else if (anchor.coordinateSpace === "PAGE" && targetSpace === "VIEWPORT") {
    if (!context.scroll) {
      throw new Error("Conversion PAGE -> VIEWPORT requires context.scroll");
    }
    const vp: ViewportCoordinates = pageToViewport(
      { px: anchor.bounds.x, py: anchor.bounds.y },
      context.scroll
    );
    newX = vp.vx;
    newY = vp.vy;
  } else {
    throw new Error(
      `Unsupported coordinate conversion from '${anchor.coordinateSpace}' to '${targetSpace}'`
    );
  }

  const newBounds: BoundingBox = {
    x: newX,
    y: newY,
    width: anchor.bounds.width,
    height: anchor.bounds.height,
  };

  const newCenter = calculateCenter(newBounds);

  return {
    ...anchor,
    bounds: newBounds,
    center: newCenter,
    coordinateSpace: targetSpace,
  };
}
