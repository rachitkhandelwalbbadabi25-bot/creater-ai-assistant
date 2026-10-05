import { describe, it, expect } from "./bunTestPolyfill.js";
import * as fs from "fs";
import * as path from "path";
import { dispatchTool } from "../src/tools/dispatcher.js";
import { evaluateCuaPolicy } from "../src/cua/cuaPolicy.js";
import { checkToolSafety, validateCommand } from "../src/tools/safety.js";
import { captureDomElement } from "../src/cua/screenAnalyzer.js";
import { createVisualAnchor, validateVisualAnchor, convertAnchorCoordinateSpace } from "../src/cua/visualAnchor.js";
import { verifyCuaAction } from "../src/cua/cuaVerifier.js";
import { browserSessionManager } from "../src/mcp/browser/sessionManager.js";
import { processConfirmation } from "../src/graph/supervisor.js";

describe("Phase 5 + Phase 5.5 — Final Integration & Regression Gate Suite", () => {
  const gateDir = path.join(process.cwd(), "data", "checkpoints", "gate_e2e_test");

  it("1. Native Filesystem E2E Workflow via Dispatcher & Verification", async () => {
    if (!fs.existsSync(gateDir)) {
      fs.mkdirSync(gateDir, { recursive: true });
    }

    const testFile = path.join(gateDir, "e2e_source.txt");
    const copyDest = path.join(gateDir, "e2e_copied.txt");
    const moveDest = path.join(gateDir, "e2e_moved.txt");

    // 1. Create/write file via dispatchTool
    await dispatchTool("fs.write_file", {
      path: testFile,
      content: "Creater AI Final Integration Gate File Content",
    });

    // Verify structured write result & file system state
    expect(fs.existsSync(testFile)).toBe(true);

    // 2. Read file via dispatchTool & verify content
    const readContent = await dispatchTool("fs.read_file", { path: testFile });
    expect(readContent).toBe("Creater AI Final Integration Gate File Content");

    // 3. Inspect metadata
    const meta = (await dispatchTool("fs.file_metadata", { path: testFile })) as any;
    expect(meta.isFile).toBe(true);
    expect(meta.sizeBytes).toBeGreaterThan(0);

    // 4. Copy file & verify destination
    await dispatchTool("fs.copy_file", { src: testFile, dest: copyDest });
    expect(fs.existsSync(copyDest)).toBe(true);

    // 5. Move file & verify destination + source removal
    await dispatchTool("fs.move_file", { src: testFile, dest: moveDest });
    expect(fs.existsSync(moveDest)).toBe(true);
    expect(fs.existsSync(testFile)).toBe(false);

    // 6. Search files
    const searchRes = (await dispatchTool("fs.search_files", { query: "e2e_moved", base_dir: gateDir })) as any[];
    expect(searchRes.some((r) => r.name.includes("e2e_moved"))).toBe(true);

    // Clean up
    if (fs.existsSync(moveDest)) fs.unlinkSync(moveDest);
    if (fs.existsSync(copyDest)) fs.unlinkSync(copyDest);
    if (fs.existsSync(gateDir)) fs.rmdirSync(gateDir);
  });

  it("2. OS E2E Workflow via Dispatcher (Info, Process, Env, Clipboard)", async () => {
    // 1. Get system information
    const sysInfo = (await dispatchTool("system.info", {})) as any;
    expect(sysInfo.cpu).toBeDefined();
    expect(sysInfo.ram).toBeDefined();
    expect(sysInfo.os).toBeDefined();

    // 2. Get process list
    const procs = (await dispatchTool("system.process_list", { top_n: 5 })) as any[];
    expect(Array.isArray(procs)).toBe(true);
    expect(procs.length).toBeGreaterThan(0);

    // 3. Environment variables
    const envVars = (await dispatchTool("system.env", { keys: ["NODE_ENV", "PATH"] })) as any;
    expect(envVars).toBeDefined();

    // 4. Clipboard operation
    await dispatchTool("system.clipboard", { action: "write", text: "Integration Gate Clipboard Value" });
    const clipVal = await dispatchTool("system.clipboard", { action: "read" });
    expect(clipVal).toBe("Integration Gate Clipboard Value");
  });

  it("3. Shell Execution E2E Workflow & Dangerous Command Rejection", async () => {
    // 1. Validate safe command validation logic
    const safeCheck = validateCommand("echo Hello Integration Gate");
    expect(safeCheck.allowed).toBe(true);
    expect(safeCheck.requiresConfirmation).toBe(true);

    // 2. Verify dangerous command is rejected by safety validation
    const blockedCheck = validateCommand("rm -rf /");
    expect(blockedCheck.allowed).toBe(false);
    expect(blockedCheck.riskLevel).toBe("critical");
  });

  it("4. CUA Execution Policy Precedence Integration", () => {
    // 1. Native tool available -> NATIVE layer, CUA NOT REQUIRED
    const nativePol = evaluateCuaPolicy({ toolId: "fs.read_file" });
    expect(nativePol.targetLayer).toBe("NATIVE");
    expect(nativePol.decision).toBe("CUA_NOT_REQUIRED");

    // 2. DOM tool available -> DOM layer, CUA NOT REQUIRED
    const domPol = evaluateCuaPolicy({ toolId: "browser.navigate" });
    expect(domPol.targetLayer).toBe("DOM");
    expect(domPol.decision).toBe("CUA_NOT_REQUIRED");

    // 3. Visual tool required -> CUA layer, CUA REQUIRED
    const cuaPol = evaluateCuaPolicy({ toolId: "cua.click_coordinate" });
    expect(cuaPol.targetLayer).toBe("CUA");
    expect(cuaPol.decision).toBe("CUA_REQUIRED");

    // 4. Permanent DOM failure -> CUA ALLOWED
    const failPol = evaluateCuaPolicy({
      toolId: "computer.click_selector",
      failure: { attemptedLayer: "DOM", error: "Selector missing", isRetryable: false },
    });
    expect(failPol.targetLayer).toBe("CUA");
    expect(failPol.decision).toBe("CUA_ALLOWED");

    // 5. User cancellation -> CUA UNAVAILABLE
    const cancelPol = evaluateCuaPolicy({ toolId: "cua.click_coordinate", userCancelled: true });
    expect(cancelPol.decision).toBe("CUA_UNAVAILABLE");

    // 6. Safety blocked command -> CUA UNAVAILABLE
    const safetyPol = evaluateCuaPolicy({ toolId: "shell.execute", params: { command: "rm -rf /" }, safetyApproved: false });
    expect(safetyPol.decision).toBe("CUA_UNAVAILABLE");
  });

  it("5. CUA Foundation Chain Integration (Policy -> Analyzer -> Anchor -> Verifier)", async () => {
    const tabId = await browserSessionManager.openTab();
    try {
      await browserSessionManager.executeOnPage(async (page) => {
        await page.setContent("<html><body><button id='action-btn' style='width:120px;height:40px;'>Submit Task</button></body></html>");
      }, tabId);

      // 1. Policy check
      const policy = evaluateCuaPolicy({ toolId: "cua.click_coordinate" });
      expect(policy.decision).toBe("CUA_REQUIRED");

      // 2. Screen Inspection
      const inspectRes = await captureDomElement("#action-btn", undefined, tabId);
      expect(inspectRes.success).toBe(true);

      if (inspectRes.success) {
        // 3. Visual Anchor creation
        const anchor = createVisualAnchor({
          id: "action_btn_anchor",
          type: "button",
          bounds: inspectRes.metadata.bounds || { x: 0, y: 0, width: 120, height: 40 },
          confidence: 1.0,
          coordinateSpace: "VIEWPORT",
          source: "screenAnalyzer",
        });

        // 4. Anchor validation
        const valRes = validateVisualAnchor(anchor, { width: 1280, height: 720 });
        expect(valRes.valid).toBe(true);
        expect(valRes.targetCenter).toBeDefined();

        // 5. Coordinate conversion
        const screenAnchor = convertAnchorCoordinateSpace(anchor, "SCREEN", { windowOffset: { x: 100, y: 100 } });
        expect(screenAnchor.coordinateSpace).toBe("SCREEN");

        // Cleanup temporary element screenshot
        if (fs.existsSync(inspectRes.metadata.filePath)) {
          fs.unlinkSync(inspectRes.metadata.filePath);
        }
      }

      // 6. Post-Action Verification
      const verifRes = await verifyCuaAction({ type: "element_present", selector: "#action-btn" }, tabId);
      expect(verifRes.status).toBe("VERIFIED");
      expect(verifRes.confidence).toBe(1.0);
    } finally {
      await browserSessionManager.closeTab(tabId);
    }
  });

  it("6. Post-Action Verification Engine non-retry and non-mutation behavior", async () => {
    const tabId = await browserSessionManager.openTab();
    try {
      await browserSessionManager.executeOnPage(async (page) => {
        await page.setContent("<html><body><p id='status'>Pending</p></body></html>");
      }, tabId);

      // Mismatch check returns NOT_VERIFIED directly without retry loop
      const mismatch = await verifyCuaAction({ type: "text_present", text: "Completed Successfully" }, tabId);
      expect(mismatch.status).toBe("NOT_VERIFIED");
      expect(mismatch.success).toBe(false);

      // Verify DOM was not mutated
      const currentText = await browserSessionManager.executeOnPage(async (page) => {
        return page.evaluate(() => document.getElementById("status")?.innerText);
      }, tabId);
      expect(currentText).toBe("Pending");
    } finally {
      await browserSessionManager.closeTab(tabId);
    }
  });

  it("7. Safety & Confirmation Flow Integration", async () => {
    // 1. Safe tool -> allowed, no confirmation
    const safeCheck = checkToolSafety("fs.read_file");
    expect(safeCheck.allowed).toBe(true);
    expect(safeCheck.requiresConfirmation).toBe(false);

    // 2. Sensitive tool -> requires confirmation
    const sensitiveCheck = checkToolSafety("fs.move_file");
    expect(sensitiveCheck.allowed).toBe(true);
    expect(sensitiveCheck.riskLevel).toBe("medium");

    // 3. Supervisor confirmation processing returns structured confirmation string
    const supervisorRes = await processConfirmation(false, "fs.move_file", { src: "a.txt", dest: "b.txt" });
    expect(typeof supervisorRes).toBe("string");
    expect(supervisorRes).toContain("cancel");
  });
});
