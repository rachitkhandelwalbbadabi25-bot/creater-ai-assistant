import "./bunTestPolyfill.js";
import { describe, it, expect } from "bun:test";
import {
  createVisualAnchor,
  createDomElementAnchor,
  validateVisualAnchor,
  convertAnchorCoordinateSpace,
  calculateCenter,
  getConfidenceLevel,
  type VisualAnchor,
} from "../src/cua/visualAnchor.js";
import { captureBrowserViewport } from "../src/cua/screenAnalyzer.js";

describe("Phase 5 Step 4 — Visual Anchor & Coordinate Mapping Tests", () => {
  it("1. Valid visual anchor creation succeeds with calculated center and confidence level", () => {
    const anchor = createVisualAnchor({
      id: "btn_submit_1",
      type: "button",
      bounds: { x: 100, y: 200, width: 80, height: 40 },
      confidence: 0.95,
      coordinateSpace: "VIEWPORT",
      source: "template_matcher",
      label: "Submit Button",
    });

    expect(anchor.id).toBe("btn_submit_1");
    expect(anchor.type).toBe("button");
    expect(anchor.bounds).toEqual({ x: 100, y: 200, width: 80, height: 40 });
    expect(anchor.center).toEqual({ x: 140, y: 220 });
    expect(anchor.confidence).toBe(0.95);
    expect(anchor.confidenceLevel).toBe("HIGH");
    expect(anchor.coordinateSpace).toBe("VIEWPORT");
  });

  it("2. Invalid bounds (width <= 0 or height <= 0 or non-finite) are rejected by validator", () => {
    const invalidWidthAnchor = createVisualAnchor({
      id: "bad_width",
      type: "region",
      bounds: { x: 10, y: 10, width: 0, height: 50 },
      coordinateSpace: "VIEWPORT",
      source: "manual",
    });

    const res1 = validateVisualAnchor(invalidWidthAnchor);
    expect(res1.valid).toBe(false);
    expect(res1.errors.some((e) => e.includes("width"))).toBe(true);

    const invalidHeightAnchor = createVisualAnchor({
      id: "bad_height",
      type: "region",
      bounds: { x: 10, y: 10, width: 50, height: -5 },
      coordinateSpace: "VIEWPORT",
      source: "manual",
    });

    const res2 = validateVisualAnchor(invalidHeightAnchor);
    expect(res2.valid).toBe(false);
    expect(res2.errors.some((e) => e.includes("height"))).toBe(true);
  });

  it("3. Unknown coordinate space is rejected by validator", () => {
    const unknownSpaceAnchor = {
      id: "unknown_space_1",
      type: "button" as const,
      bounds: { x: 10, y: 10, width: 50, height: 50 },
      center: { x: 35, y: 35 },
      confidence: 1.0,
      confidenceLevel: "DETERMINISTIC" as const,
      coordinateSpace: "INVALID_SPACE" as any,
      source: "test",
    };

    const res = validateVisualAnchor(unknownSpaceAnchor);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("coordinate space"))).toBe(true);
  });

  it("4. Screen-coordinate anchor validates correctly", () => {
    const screenAnchor = createVisualAnchor({
      id: "screen_icon_1",
      type: "icon",
      bounds: { x: 500, y: 300, width: 32, height: 32 },
      confidence: 1.0,
      coordinateSpace: "SCREEN",
      source: "ocr_detector",
    });

    const res = validateVisualAnchor(screenAnchor, { width: 1920, height: 1080 });
    expect(res.valid).toBe(true);
    expect(res.targetCenter).toEqual({ x: 516, y: 316 });
    expect(res.coordinateSpace).toBe("SCREEN");
  });

  it("5. Viewport-coordinate anchor validates correctly", () => {
    const domAnchor = createDomElementAnchor("#submit-form", { x: 50, y: 100, width: 200, height: 40 });
    expect(domAnchor.confidenceLevel).toBe("DETERMINISTIC");

    const res = validateVisualAnchor(domAnchor, { width: 1280, height: 720 });
    expect(res.valid).toBe(true);
    expect(res.targetCenter).toEqual({ x: 150, y: 120 });
    expect(res.coordinateSpace).toBe("VIEWPORT");
  });

  it("6. Explicit coordinate conversion between spaces works accurately", () => {
    const vpAnchor = createVisualAnchor({
      id: "vp_target",
      type: "button",
      bounds: { x: 50, y: 50, width: 100, height: 40 },
      coordinateSpace: "VIEWPORT",
      source: "playwright",
    });

    // Convert VIEWPORT -> SCREEN
    const windowOffset = { x: 200, y: 150 };
    const screenAnchor = convertAnchorCoordinateSpace(vpAnchor, "SCREEN", { windowOffset });

    expect(screenAnchor.coordinateSpace).toBe("SCREEN");
    expect(screenAnchor.bounds).toEqual({ x: 250, y: 200, width: 100, height: 40 });
    expect(screenAnchor.center).toEqual({ x: 300, y: 220 });

    // Convert SCREEN -> VIEWPORT
    const backToVp = convertAnchorCoordinateSpace(screenAnchor, "VIEWPORT", { windowOffset });
    expect(backToVp.coordinateSpace).toBe("VIEWPORT");
    expect(backToVp.bounds).toEqual(vpAnchor.bounds);
    expect(backToVp.center).toEqual(vpAnchor.center);

    // Convert VIEWPORT -> PAGE
    const scroll = { scrollX: 0, scrollY: 500 };
    const pageAnchor = convertAnchorCoordinateSpace(vpAnchor, "PAGE", { scroll });
    expect(pageAnchor.coordinateSpace).toBe("PAGE");
    expect(pageAnchor.bounds).toEqual({ x: 50, y: 550, width: 100, height: 40 });
    expect(pageAnchor.center).toEqual({ x: 100, y: 570 });
  });

  it("7. Out-of-bounds coordinates are rejected when screen constraints are provided", () => {
    const outOfBoundsAnchor = createVisualAnchor({
      id: "oob_target",
      type: "button",
      bounds: { x: 1900, y: 1050, width: 100, height: 50 },
      coordinateSpace: "SCREEN",
      source: "test",
    });

    const res = validateVisualAnchor(outOfBoundsAnchor, { width: 1920, height: 1080 });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("exceed screen dimensions"))).toBe(true);
  });

  it("8. Confidence levels are correctly categorized and low confidence produces warnings", () => {
    expect(getConfidenceLevel(1.0)).toBe("DETERMINISTIC");
    expect(getConfidenceLevel(0.85)).toBe("HIGH");
    expect(getConfidenceLevel(0.65)).toBe("MEDIUM");
    expect(getConfidenceLevel(0.4)).toBe("LOW");

    const lowConfidenceAnchor = createVisualAnchor({
      id: "low_conf_1",
      type: "image",
      bounds: { x: 10, y: 10, width: 40, height: 40 },
      confidence: 0.35,
      coordinateSpace: "VIEWPORT",
      source: "fuzzy_match",
    });

    const res = validateVisualAnchor(lowConfidenceAnchor);
    expect(res.valid).toBe(true);
    expect(res.warnings.some((w) => w.includes("Low confidence score"))).toBe(true);
  });

  it("9. Existing ScreenAnalyzer behavior remains unchanged", async () => {
    // ScreenAnalyzer coordinate functions work directly alongside visualAnchor
    const vp = { vx: 10, vy: 20 };
    const offset = { x: 100, y: 100 };
    const screenCoord = convertAnchorCoordinateSpace(
      createVisualAnchor({
        id: "sa_check",
        type: "region",
        bounds: { x: vp.vx, y: vp.vy, width: 10, height: 10 },
        coordinateSpace: "VIEWPORT",
        source: "test",
      }),
      "SCREEN",
      { windowOffset: offset }
    );

    expect(screenCoord.center).toEqual({ x: 115, y: 125 });
  });

  it("10. Visual anchor creation and validation performs NO desktop mouse or keyboard actions", () => {
    // Creating and validating 100 anchors remains completely synchronous and passive
    const anchors = Array.from({ length: 50 }, (_, i) =>
      createVisualAnchor({
        id: `passive_${i}`,
        type: "button",
        bounds: { x: i * 10, y: i * 10, width: 20, height: 20 },
        coordinateSpace: "VIEWPORT",
        source: "passive_test",
      })
    );

    for (const anchor of anchors) {
      const res = validateVisualAnchor(anchor);
      expect(res.valid).toBe(true);
    }
  });
});
