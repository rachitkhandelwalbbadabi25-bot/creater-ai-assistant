import "./bunTestPolyfill.js";
import { describe, it, expect, beforeEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import {
  captureDesktopScreen,
  captureBrowserViewport,
  captureDomElement,
  getPngDimensions,
  viewportToScreen,
  screenToViewport,
  viewportToPage,
  pageToViewport,
} from "../src/cua/screenAnalyzer.js";
import { takeScreenshotOfPage } from "../src/tools/laptop/computer.js";
import { browserSessionManager } from "../src/mcp/browser/sessionManager.js";

describe("Phase 5 Step 3 — Screen Inspection Foundation Tests", () => {
  beforeEach(async () => {
    // Ensure clean state before each test
  });

  it("1. Coordinate system conversions are consistent and accurate", () => {
    const windowOffset = { x: 100, y: 200 };
    const vpCoord = { vx: 50, vy: 75 };

    const screenCoord = viewportToScreen(vpCoord, windowOffset);
    expect(screenCoord).toEqual({ x: 150, y: 275 });

    const backToVp = screenToViewport(screenCoord, windowOffset);
    expect(backToVp).toEqual(vpCoord);

    const scroll = { scrollX: 0, scrollY: 400 };
    const pageCoord = viewportToPage(vpCoord, scroll);
    expect(pageCoord).toEqual({ px: 50, py: 475 });

    const backToPageVp = pageToViewport(pageCoord, scroll);
    expect(backToPageVp).toEqual(vpCoord);
  });

  it("2. Reads PNG dimensions from PNG header correctly", () => {
    const minimalPngHex =
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082";
    const testDir = path.join(process.cwd(), "data", "checkpoints", "test_png");
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    const testPath = path.join(testDir, "test_1x1.png");
    fs.writeFileSync(testPath, Buffer.from(minimalPngHex, "hex"));

    const dims = getPngDimensions(testPath);
    expect(dims.width).toBe(1);
    expect(dims.height).toBe(1);

    fs.unlinkSync(testPath);
  });

  it("3. Captures browser viewport screenshot and returns valid metadata", async () => {
    const tabId = await browserSessionManager.openTab();
    try {
      await browserSessionManager.executeOnPage(async (page) => {
        await page.setContent("<html><body><h1>Screen Inspection Test</h1></body></html>");
      }, tabId);

      const res = await captureBrowserViewport(undefined, tabId);
      expect(res.success).toBe(true);

      if (res.success) {
        expect(res.metadata.sourceType).toBe("BROWSER_VIEWPORT");
        expect(fs.existsSync(res.metadata.filePath)).toBe(true);
        expect(res.metadata.width).toBeGreaterThan(0);
        expect(res.metadata.height).toBeGreaterThan(0);
        expect(res.metadata.mimeType).toBe("image/png");
        expect(res.metadata.timestamp).toBeGreaterThan(0);

        if (fs.existsSync(res.metadata.filePath)) {
          fs.unlinkSync(res.metadata.filePath);
        }
      }
    } finally {
      await browserSessionManager.closeTab(tabId);
    }
  });

  it("4. Captures DOM element screenshot and metadata", async () => {
    const tabId = await browserSessionManager.openTab();
    try {
      await browserSessionManager.executeOnPage(async (page) => {
        await page.setContent(
          "<html><body><div id='target-box' style='width:100px;height:50px;background:red;'>Box</div></body></html>"
        );
      }, tabId);

      const res = await captureDomElement("#target-box", undefined, tabId);
      expect(res.success).toBe(true);

      if (res.success) {
        expect(res.metadata.sourceType).toBe("BROWSER_ELEMENT");
        expect(fs.existsSync(res.metadata.filePath)).toBe(true);
        expect(res.metadata.width).toBeGreaterThan(0);
        expect(res.metadata.height).toBeGreaterThan(0);
        expect(res.metadata.bounds).toBeDefined();

        if (fs.existsSync(res.metadata.filePath)) {
          fs.unlinkSync(res.metadata.filePath);
        }
      }
    } finally {
      await browserSessionManager.closeTab(tabId);
    }
  });

  it("5. Screenshot failure returns structured error", async () => {
    const res = await captureDomElement("#non-existent-element-xyz");
    expect(res.success).toBe(false);

    if (!res.success) {
      expect(res.error.code).toBe("ELEMENT_NOT_FOUND");
      expect(res.error.sourceType).toBe("BROWSER_ELEMENT");
      expect(res.error.message).toContain("non-existent-element-xyz");
    }
  });

  it("6. Existing browser screenshot behavior remains unchanged", async () => {
    const pageResult = await takeScreenshotOfPage();
    expect(pageResult).toContain("Screenshot saved:");

    const match = pageResult.match(/Screenshot saved: (.*)/);
    if (match && match[1]) {
      const createdPath = match[1];
      expect(fs.existsSync(createdPath)).toBe(true);
      fs.unlinkSync(createdPath);
    }
  });

  it("7. Passive screen inspection performs no action or mutations", async () => {
    const tabId = await browserSessionManager.openTab();
    try {
      await browserSessionManager.executeOnPage(async (page) => {
        await page.setContent(`
          <html><body>
            <button id="test-btn" onclick="window.clicked=true">Click Me</button>
          </body></html>
        `);
      }, tabId);

      // Run screen inspection on element
      const res = await captureDomElement("#test-btn", undefined, tabId);
      expect(res.success).toBe(true);

      // Verify window.clicked was NOT triggered
      const wasClicked = await browserSessionManager.executeOnPage(async (page) => {
        return page.evaluate(() => (window as any).clicked === true);
      }, tabId);

      expect(wasClicked).toBe(false);

      if (res.success && fs.existsSync(res.metadata.filePath)) {
        fs.unlinkSync(res.metadata.filePath);
      }
    } finally {
      await browserSessionManager.closeTab(tabId);
    }
  });

  it("8. Desktop screenshot capture succeeds or handles screen availability gracefully", async () => {
    const res = await captureDesktopScreen();
    if (res.success) {
      expect(res.metadata.sourceType).toBe("DESKTOP_SCREEN");
      expect(fs.existsSync(res.metadata.filePath)).toBe(true);
      if (fs.existsSync(res.metadata.filePath)) {
        fs.unlinkSync(res.metadata.filePath);
      }
    } else {
      expect(res.error.code).toBe("CAPTURE_FAILED");
      expect(res.error.sourceType).toBe("DESKTOP_SCREEN");
    }
  });
});
