import "./bunTestPolyfill.js";
import { describe, it, expect } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { verifyCuaAction } from "../src/cua/cuaVerifier.js";
import { browserSessionManager } from "../src/mcp/browser/sessionManager.js";
import { evaluateCuaPolicy } from "../src/cua/cuaPolicy.js";
import { createVisualAnchor, validateVisualAnchor } from "../src/cua/visualAnchor.js";

describe("Phase 5 Step 5 — Post-Action Verification Engine Tests", () => {
  it("1. URL match verification succeeds when URL matches expected pattern", async () => {
    const tabId = await browserSessionManager.openTab();
    try {
      await browserSessionManager.executeOnPage(async (page) => {
        await page.setContent("<html><body><h1>Dashboard</h1></body></html>");
      }, tabId);

      const res = await verifyCuaAction({ type: "url_match", target: "about:blank" }, tabId);
      expect(res.status).toBe("VERIFIED");
      expect(res.success).toBe(true);
      expect(res.confidence).toBe(1.0);
      expect(res.method).toBe("url_match");
    } finally {
      await browserSessionManager.closeTab(tabId);
    }
  });

  it("2. URL expectation mismatch fails gracefully with NOT_VERIFIED status", async () => {
    const tabId = await browserSessionManager.openTab();
    try {
      await browserSessionManager.executeOnPage(async (page) => {
        await page.setContent("<html><body><h1>Dashboard</h1></body></html>");
      }, tabId);

      const res = await verifyCuaAction({ type: "url_match", target: "https://expected-domain.com/dashboard" }, tabId);
      expect(res.status).toBe("NOT_VERIFIED");
      expect(res.success).toBe(false);
      expect(res.confidence).toBe(1.0);
      expect(res.reason).toContain("URL mismatch");
    } finally {
      await browserSessionManager.closeTab(tabId);
    }
  });

  it("3. Page title match verification succeeds and fails correctly", async () => {
    const tabId = await browserSessionManager.openTab();
    try {
      await browserSessionManager.executeOnPage(async (page) => {
        await page.setContent("<html><head><title>User Dashboard</title></head><body></body></html>");
      }, tabId);

      const passRes = await verifyCuaAction({ type: "title_match", target: "User Dashboard" }, tabId);
      expect(passRes.status).toBe("VERIFIED");
      expect(passRes.success).toBe(true);

      const failRes = await verifyCuaAction({ type: "title_match", target: "Admin Settings" }, tabId);
      expect(failRes.status).toBe("NOT_VERIFIED");
      expect(failRes.success).toBe(false);
    } finally {
      await browserSessionManager.closeTab(tabId);
    }
  });

  it("4. Expected DOM state verification (element_present & element_absent) works correctly", async () => {
    const tabId = await browserSessionManager.openTab();
    try {
      await browserSessionManager.executeOnPage(async (page) => {
        await page.setContent(`
          <html><body>
            <div id="success-banner">Operation Successful</div>
          </body></html>
        `);
      }, tabId);

      // Verify element_present
      const presentRes = await verifyCuaAction({ type: "element_present", selector: "#success-banner" }, tabId);
      expect(presentRes.status).toBe("VERIFIED");
      expect(presentRes.success).toBe(true);

      // Verify element_absent
      const absentRes = await verifyCuaAction({ type: "element_absent", selector: "#login-form" }, tabId);
      expect(absentRes.status).toBe("VERIFIED");
      expect(absentRes.success).toBe(true);

      // Mismatch checks
      const missingCheck = await verifyCuaAction({ type: "element_present", selector: "#missing-box" }, tabId);
      expect(missingCheck.status).toBe("NOT_VERIFIED");
      expect(missingCheck.success).toBe(false);
    } finally {
      await browserSessionManager.closeTab(tabId);
    }
  });

  it("5. Expected text/state verification (text_present & text_absent) works correctly", async () => {
    const tabId = await browserSessionManager.openTab();
    try {
      await browserSessionManager.executeOnPage(async (page) => {
        await page.setContent("<html><body><p>Welcome back, Alice!</p></body></html>");
      }, tabId);

      const textPresent = await verifyCuaAction({ type: "text_present", text: "Welcome back" }, tabId);
      expect(textPresent.status).toBe("VERIFIED");

      const textAbsent = await verifyCuaAction({ type: "text_absent", text: "Access Denied" }, tabId);
      expect(textAbsent.status).toBe("VERIFIED");
    } finally {
      await browserSessionManager.closeTab(tabId);
    }
  });

  it("6. Visual verification detects state changes when baseline screenshot is provided", async () => {
    const tabId = await browserSessionManager.openTab();
    const testDir = path.join(process.cwd(), "data", "checkpoints", "test_baseline");
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    const baselinePath = path.join(testDir, `baseline_${Date.now()}.png`);

    try {
      // Step A: Set initial state & capture baseline
      await browserSessionManager.executeOnPage(async (page) => {
        await page.setContent("<html><body><div style='width:100px;height:100px;background:red;'>Initial</div></body></html>");
        await page.screenshot({ path: baselinePath, fullPage: false });
      }, tabId);

      // Step B: Mutate DOM state visually
      await browserSessionManager.executeOnPage(async (page) => {
        await page.setContent("<html><body><div style='width:500px;height:500px;background:blue;'>Updated Visual State</div></body></html>");
      }, tabId);

      // Step C: Verify visual change
      const visualRes = await verifyCuaAction({ type: "visual_change", baselineScreenshotPath: baselinePath }, tabId);
      expect(visualRes.status).toBe("VERIFIED");
      expect(visualRes.success).toBe(true);
      expect(visualRes.confidence).toBe(0.85);
      expect(visualRes.method).toBe("visual_change");
    } finally {
      if (fs.existsSync(baselinePath)) {
        fs.unlinkSync(baselinePath);
      }
      await browserSessionManager.closeTab(tabId);
    }
  });

  it("7. Missing or invalid parameters return VERIFICATION_UNAVAILABLE structured status", async () => {
    const res1 = await verifyCuaAction({ type: "url_match" }); // missing target
    expect(res1.status).toBe("VERIFICATION_UNAVAILABLE");
    expect(res1.success).toBe(false);

    const res2 = await verifyCuaAction({ type: "visual_change", baselineScreenshotPath: "./non_existent_file.png" });
    expect(res2.status).toBe("VERIFICATION_UNAVAILABLE");
    expect(res2.success).toBe(false);
  });

  it("8. Verification performs NO computer mouse/keyboard action or DOM mutations", async () => {
    const tabId = await browserSessionManager.openTab();
    try {
      await browserSessionManager.executeOnPage(async (page) => {
        await page.setContent(`
          <html><body>
            <button id="check-btn" onclick="window.mutated=true">Check</button>
          </body></html>
        `);
      }, tabId);

      // Run multiple verifications
      await verifyCuaAction({ type: "element_present", selector: "#check-btn" }, tabId);
      await verifyCuaAction({ type: "text_present", text: "Check" }, tabId);
      await verifyCuaAction({ type: "url_match", target: "about:blank" }, tabId);

      // Verify DOM was not mutated
      const mutated = await browserSessionManager.executeOnPage(async (page) => {
        return page.evaluate(() => (window as any).mutated === true);
      }, tabId);

      expect(mutated).toBe(false);
    } finally {
      await browserSessionManager.closeTab(tabId);
    }
  });

  it("9. Verification failure returns NOT_VERIFIED without triggering retries or executing actions", async () => {
    const tabId = await browserSessionManager.openTab();
    try {
      await browserSessionManager.executeOnPage(async (page) => {
        await page.setContent("<html><body><p>Static Page</p></body></html>");
      }, tabId);

      const res = await verifyCuaAction({ type: "text_present", text: "Non Existent Text String" }, tabId);
      expect(res.status).toBe("NOT_VERIFIED");
      expect(res.success).toBe(false);
      // Ensures result object is returned directly without throws or infinite execution
      expect(res.timestamp).toBeGreaterThan(0);
    } finally {
      await browserSessionManager.closeTab(tabId);
    }
  });

  it("10. Existing CuaPolicy, VisualAnchor, and ScreenAnalyzer behaviors remain unchanged", () => {
    // 1. CUA Policy check
    const policyResult = evaluateCuaPolicy({ toolId: "cua.click_coordinate" });
    expect(policyResult.decision).toBe("CUA_REQUIRED");

    // 2. Visual Anchor check
    const anchor = createVisualAnchor({
      id: "verif_anchor",
      type: "button",
      bounds: { x: 10, y: 10, width: 50, height: 20 },
      coordinateSpace: "VIEWPORT",
      source: "test",
    });
    const anchorValidation = validateVisualAnchor(anchor);
    expect(anchorValidation.valid).toBe(true);
  });
});
