import { describe, it, expect, beforeEach } from "bun:test";
import * as path from "path";
import * as fs from "fs";
import {
  moveDesktopMouse,
  clickDesktop,
  typeDesktopText,
  pressDesktopKey,
  getActiveDesktopWindow,
  focusDesktopWindow,
  commentOnYouTubeDesktop,
  evaluateYouTubeCommentLifecycle,
  saveDesktopAppDocument,
  verifySavedDesktopFile,
  sendWorkerRpcRequest,
  sendRawWorkerLine,
  getDesktopWorkerStats,
  killDesktopWorkerForTest,
  shutdownDesktopWorker,
  runDesktopControlCold,
} from "../src/tools/laptop/desktopControl.js";
import {
  createPointAnchor,
  createBoxAnchor,
  createDomElementAnchor,
  resolveAnchorCoordinates,
  convertAnchorCoordinateSpace,
  validateVisualAnchor,
} from "../src/cua/visualAnchor.js";
import { evaluateCuaPolicy } from "../src/cua/cuaPolicy.js";
import { advancedCuaEngine } from "../src/cua/cuaEngine.js";
import { verifyCuaAction } from "../src/cua/cuaVerifier.js";
import { cuaTracer } from "../src/cua/tracer.js";
import { mcpRegistry } from "../src/mcp/registry.js";
import { mcpCoordinator } from "../src/mcp/coordinator.js";
import { dispatchTool } from "../src/tools/dispatcher.js";
import { tracer } from "../src/monitoring/tracer.js";

describe("Phase 8: Advanced CUA + Multi-MCP", () => {
  beforeEach(() => {
    tracer.clear();
  });

  describe("1. Native Desktop CUA Controller", () => {
    it("moves the cursor and returns coordinate confirmation", async () => {
      const res = await moveDesktopMouse(150, 150);
      expect(res.success).toBe(true);
      expect(res.action).toBe("move");
    }, 15000);

    it("performs native mouse clicks (left, right, double)", async () => {
      const leftClick = await clickDesktop(200, 200, "left");
      expect(leftClick.success).toBe(true);
      expect(leftClick.button).toBe("left");

      const rightClick = await clickDesktop(200, 200, "right");
      expect(rightClick.success).toBe(true);
      expect(rightClick.button).toBe("right");

      const doubleClick = await clickDesktop(200, 200, "double");
      expect(doubleClick.success).toBe(true);
      expect(doubleClick.button).toBe("double");
    }, 30000);

    it("types text and presses special keys safely", async () => {
      const typeRes = await typeDesktopText("");
      expect(typeRes.success).toBe(true);
      expect(typeRes.action).toBe("type");

      const keyRes = await pressDesktopKey("{ESC}");
      expect(keyRes.success).toBe(true);
      expect(keyRes.action).toBe("key");
    }, 15000);

    it("retrieves the active desktop window metadata", async () => {
      const win = await getActiveDesktopWindow();
      expect(win.success).toBe(true);
      expect(win.bounds).toBeDefined();
    }, 15000);

    it("handles window focus attempts gracefully", async () => {
      const focusRes = await focusDesktopWindow("NonExistentWindow_999999");
      expect(focusRes.success).toBe(false);
      expect(focusRes.found).toBe(false);
    }, 15000);
  });

  describe("2. Visual Grounding & Anchors", () => {
    it("creates point and bounding-box anchors with calculated center", () => {
      const pt = createPointAnchor(500, 400, "SCREEN", "submit_button");
      expect(pt.id).toBeDefined();
      expect(pt.center.x).toBe(500);
      expect(pt.center.y).toBe(400);
      expect(pt.confidenceLevel).toBe("DETERMINISTIC");

      const box = createBoxAnchor(100, 200, 300, 100, "SCREEN", "dialog_box");
      expect(box.center.x).toBe(250); // 100 + 300/2
      expect(box.center.y).toBe(250); // 200 + 100/2
    });

    it("converts anchor coordinate spaces (VIEWPORT -> SCREEN)", () => {
      const vpAnchor = createDomElementAnchor("button#play", { x: 50, y: 50, width: 100, height: 40 });
      expect(vpAnchor.coordinateSpace).toBe("VIEWPORT");

      const screenAnchor = convertAnchorCoordinateSpace(vpAnchor, "SCREEN", {
        windowOffset: { x: 200, y: 150 },
      });

      expect(screenAnchor.coordinateSpace).toBe("SCREEN");
      expect(screenAnchor.bounds.x).toBe(250); // 50 + 200
      expect(screenAnchor.bounds.y).toBe(200); // 50 + 150
      expect(screenAnchor.center.x).toBe(300); // 250 + 50
      expect(screenAnchor.center.y).toBe(220); // 200 + 20
    });

    it("resolves target center directly via resolveAnchorCoordinates", () => {
      const anchor = createBoxAnchor(10, 20, 100, 80, "SCREEN");
      const center = resolveAnchorCoordinates(anchor, "SCREEN");
      expect(center.x).toBe(60);
      expect(center.y).toBe(60);
    });

    it("validates anchors against screen dimensions", () => {
      const validAnchor = createPointAnchor(800, 600, "SCREEN");
      const validation = validateVisualAnchor(validAnchor, { width: 1920, height: 1080 });
      expect(validation.valid).toBe(true);

      const outOfBoundsAnchor = createPointAnchor(2500, 500, "SCREEN");
      const invalidValidation = validateVisualAnchor(outOfBoundsAnchor, { width: 1920, height: 1080 });
      expect(invalidValidation.valid).toBe(false);
      expect(invalidValidation.errors.length).toBeGreaterThan(0);
    });
  });

  describe("3. CUA Execution Policy (API > DOM > CUA)", () => {
    it("routes direct API tools to NATIVE layer without invoking CUA", () => {
      const result = evaluateCuaPolicy({ toolId: "system.volume" });
      expect(result.targetLayer).toBe("NATIVE");
      expect(result.decision).toBe("CUA_NOT_REQUIRED");
    });

    it("routes browser DOM tools to DOM layer without invoking CUA", () => {
      const result = evaluateCuaPolicy({ toolId: "browser.navigate" });
      expect(result.targetLayer).toBe("DOM");
      expect(result.decision).toBe("CUA_NOT_REQUIRED");
    });

    it("authorizes CUA layer when visual interaction is explicitly required", () => {
      const result = evaluateCuaPolicy({
        toolId: "computer.click",
        requiresVisualInteraction: true,
        safetyApproved: true,
      });
      expect(result.targetLayer).toBe("CUA");
      expect(["CUA_ALLOWED", "CUA_REQUIRED"]).toContain(result.decision);
    });
  });

  describe("4. Advanced CUA Closed-Loop Execution Engine", () => {
    it("executes a click CUA action with policy check and auto-tracing", async () => {
      const result = await advancedCuaEngine.execute({
        action: "click",
        target: { coordinates: { x: 300, y: 300 } },
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe("click");
      expect(result.targetAnchor).toBeDefined();
      expect(result.targetAnchor?.center.x).toBe(300);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }, 15000);

    it("executes a desktop text typing CUA action", async () => {
      const result = await advancedCuaEngine.execute({
        action: "type",
        input: { text: "Hello CUA" },
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe("type");
    }, 15000);

    it("inspects the active window via CUA engine", async () => {
      const result = await advancedCuaEngine.execute({
        action: "inspect",
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe("inspect");
    }, 15000);
  });

  describe("5. Multi-MCP Architecture & Unified Coordinator", () => {
    it("initializes and lists all registered MCP servers with tools", async () => {
      await mcpCoordinator.initializeDefaults();
      const servers = mcpRegistry.listServers();

      expect(servers.length).toBeGreaterThanOrEqual(4);
      const serverNames = servers.map((s) => s.name);
      expect(serverNames).toContain("filesystem");
      expect(serverNames).toContain("os");
      expect(serverNames).toContain("desktop");
      expect(serverNames).toContain("browser");

      const fsServer = servers.find((s) => s.name === "filesystem");
      expect(fsServer?.tools).toContain("read_file");
      expect(fsServer?.tools).toContain("write_file");

      const osServer = servers.find((s) => s.name === "os");
      expect(osServer?.tools).toContain("screenshot");
      expect(osServer?.tools).toContain("system_info");

      const desktopServer = servers.find((s) => s.name === "desktop");
      expect(desktopServer?.tools).toContain("click");
      expect(desktopServer?.tools).toContain("active_window");
    });

    it("calls tools across different MCP servers through the coordinator", async () => {
      // 1. Filesystem MCP
      const tempPath = path.resolve("./data/mcp_test_file.txt");
      const writeRes = await mcpCoordinator.callTool("filesystem", "write_file", {
        path: tempPath,
        content: "Multi-MCP Coordinator Test Data",
      });
      expect(writeRes.success).toBe(true);

      const readRes = await mcpCoordinator.callTool("filesystem", "read_file", {
        path: tempPath,
      });
      expect(readRes.success).toBe(true);
      expect(readRes.data).toContain("Multi-MCP Coordinator Test Data");

      // Cleanup
      try {
        fs.unlinkSync(tempPath);
      } catch {
        /* ignore cleanup */
      }

      // 2. OS MCP
      const osRes = await mcpCoordinator.callTool("os", "system_info", {});
      expect(osRes.success).toBe(true);
      expect((osRes.data as Record<string, unknown>)?.os).toBeDefined();

      // 3. Desktop MCP
      const desktopRes = await mcpCoordinator.callTool("desktop", "active_window", {});
      expect(desktopRes.success).toBe(true);
    }, 15000);

    it("executes a multi-step cross-MCP pipeline with context forwarding", async () => {
      const pipelineFilePath = path.resolve("./data/mcp_pipeline_test.txt");

      const pipeline = await mcpCoordinator.executePipeline([
        {
          serverName: "filesystem",
          toolName: "write_file",
          params: { path: pipelineFilePath, content: "Pipeline Phase 8 Verified" },
          outputKey: "writeResult",
        },
        {
          serverName: "filesystem",
          toolName: "read_file",
          params: { path: pipelineFilePath },
          outputKey: "readResult",
        },
        {
          serverName: "os",
          toolName: "system_info",
          params: {},
          outputKey: "sysInfo",
        },
        {
          serverName: "filesystem",
          toolName: "list_directory",
          params: { path: path.resolve("./data") },
        },
      ]);

      try {
        fs.unlinkSync(pipelineFilePath);
      } catch {
        /* ignore cleanup */
      }

      expect(pipeline.success).toBe(true);
      expect(pipeline.stepResults.length).toBe(4);
      expect(pipeline.context.readResult).toBe("Pipeline Phase 8 Verified");
      expect((pipeline.context.sysInfo as Record<string, unknown>)?.os).toBeDefined();
    }, 15000);
  });

  describe("6. Dispatcher Integration & Auto-Tracing", () => {
    it("dispatches mcp.list_servers and cua.active_window via global dispatcher", async () => {
      const serverList = (await dispatchTool("mcp.list_servers", {})) as Array<{ name: string }>;
      expect(Array.isArray(serverList)).toBe(true);
      expect(serverList.some((s) => s.name === "desktop")).toBe(true);

      const activeWin = (await dispatchTool("cua.active_window", {})) as { success: boolean };
      expect(activeWin).toBeDefined();
      expect(activeWin.success).toBe(true);
    }, 15000);

    it("automatically traces CUA and MCP tool calls into execution telemetry", async () => {
      const rootTrace = tracer.startTrace("cua_multi_mcp_journey");

      await tracer.runWithContext({ traceId: rootTrace.id }, async () => {
        await dispatchTool("cua.click", { x: 100, y: 100, button: "left" });
        await dispatchTool("mcp.call_tool", { server: "os", tool: "system_info", params: {} });
      });

      tracer.endTrace(rootTrace.id, "completed");

      const trace = tracer.getTrace(rootTrace.id);
      expect(trace).toBeDefined();
      expect(trace?.spans.some((s) => s.name === "tool:cua.click")).toBe(true);
      expect(trace?.spans.some((s) => s.name === "tool:mcp.call_tool")).toBe(true);
    }, 15000);

    it("verifies local file creation via cuaVerifier, parallel MCP groups with checkpoints, and CUA stage tracer redaction", async () => {
      cuaTracer.clear();
      const verifyFilePath = path.resolve("./data/phase8_verified_output.txt");

      const pipeline = await mcpCoordinator.executePipeline([
        {
          serverName: "filesystem",
          toolName: "write_file",
          params: { path: verifyFilePath, content: "Phase 8 Verified Multi-MCP Output" },
          outputKey: "writtenFile",
          parallelGroup: "group_init",
        },
        {
          serverName: "os",
          toolName: "system_info",
          params: {},
          outputKey: "osMeta",
          parallelGroup: "group_init",
        },
        {
          serverName: "filesystem",
          toolName: "read_file",
          params: { path: verifyFilePath },
          outputKey: "fileContent",
          dependsOn: ["writtenFile", "osMeta"],
          retries: 1,
        },
      ]);

      expect(pipeline.success).toBe(true);
      expect(pipeline.checkpoints?.length).toBe(3);
      expect(pipeline.context.fileContent).toBe("Phase 8 Verified Multi-MCP Output");

      // Verify file existence and content via cuaVerifier without spawning headless Playwright
      const verifyRes = await verifyCuaAction({
        type: "file_exists",
        filePath: verifyFilePath,
        text: "Phase 8 Verified Multi-MCP Output",
      });
      expect(verifyRes.status).toBe("VERIFIED");
      expect(verifyRes.success).toBe(true);

      try {
        fs.unlinkSync(verifyFilePath);
      } catch {
        /* ignore cleanup error */
      }

      // CUA Stage Tracer: redacts secrets and never reports SUCCESS when verificationResult is NOT_VERIFIED
      const rec = cuaTracer.recordStage({
        workflowId: "wf_phase8_test",
        stage: "VERIFY",
        targetApp: "chrome",
        executionTier: "CUA",
        perceptionLatencyMs: 140,
        uiaLatencyMs: 65,
        ocrLatencyMs: 75,
        decisionLatencyMs: 12,
        actionLatencyMs: 45,
        verificationResult: "NOT_VERIFIED",
        retryCount: 1,
        recoveryStatus: "RECOVERED",
        finalStatus: "SUCCESS",
        metadata: {
          user: "rachit",
          password: "super-secret-password",
          sessionToken: "tok_12345",
        },
      });

      expect(rec.finalStatus).toBe("PARTIAL_SUCCESS");
      expect(rec.metadata?.password).toBe("[REDACTED]");
      expect(rec.metadata?.sessionToken).toBe("[REDACTED]");
      expect(rec.metadata?.user).toBe("rachit");
    }, 15000);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. Phase 8.1: Final Reliability Hardening
  // ═══════════════════════════════════════════════════════════════════════════
  describe("7. Phase 8.1: Final Reliability Hardening (YouTube Approval, SaveApp & Persistent Worker)", () => {
    it("should require explicit approval before publishing a YouTube comment (returns AWAITING_APPROVAL)", () => {
      const pending = evaluateYouTubeCommentLifecycle({
        commentText: "hello from creater ai",
        composedReadBack: "hello from creater ai",
      });
      expect(pending.status).toBe("AWAITING_APPROVAL");
      expect(pending.requiresApproval).toBe(true);
      expect(pending.composed).toBe(true);
      expect(pending.composedVerified).toBe(true);
      expect(pending.published).toBe(false);
      expect(pending.verified).toBe(false);
      expect(pending.success).toBe(false);
    });

    it("should abort and return FAILED when YouTube comment approval is rejected", async () => {
      const rejected = await commentOnYouTubeDesktop("hello", "YouTube", "chrome", { approved: false });
      expect(rejected.status).toBe("FAILED");
      expect(rejected.approved).toBe(false);
      expect(rejected.published).toBe(false);
      expect(rejected.verified).toBe(false);
      expect(rejected.error).toContain("rejected");
    });

    it("should verify YouTube comment composition and require post-publish thread presence for SUCCESS", () => {
      // Unverified post-publish thread observation must return PARTIAL_SUCCESS, never SUCCESS
      const unverified = evaluateYouTubeCommentLifecycle({
        commentText: "great episode samay!",
        approved: true,
        composedReadBack: "great episode samay!",
        threadObservedTexts: [" unrelated top comment ", " another user comment "],
      });
      expect(unverified.published).toBe(true);
      expect(unverified.verified).toBe(false);
      expect(unverified.status).toBe("PARTIAL_SUCCESS");
      expect(unverified.success).toBe(false);

      // Verified post-publish thread observation returns SUCCESS
      const verified = evaluateYouTubeCommentLifecycle({
        commentText: "great episode samay!",
        approved: true,
        composedReadBack: "great episode samay!",
        threadObservedTexts: ["@user • 1 second ago", "great episode samay!"],
      });
      expect(verified.published).toBe(true);
      expect(verified.verified).toBe(true);
      expect(verified.status).toBe("SUCCESS");
      expect(verified.success).toBe(true);
    });

    it("should reject saveDesktopAppDocument when target parent directory is missing", async () => {
      const missingDirFile = path.resolve("./data/__nonexistent_dir_phase8_1__/notes.txt");
      const res = await saveDesktopAppDocument({
        targetApp: "notepad",
        filePath: missingDirFile,
        expectedContent: "Hello World",
      });
      expect(res.success).toBe(false);
      expect(res.status).toBe("FAILED");
      expect(res.error).toContain("does not exist");
    });

    it("should protect existing files from silent overwrite in saveDesktopAppDocument (returns AWAITING_APPROVAL)", async () => {
      const existingFile = path.resolve("./data/phase8_1_protected_test.txt");
      fs.mkdirSync(path.dirname(existingFile), { recursive: true });
      fs.writeFileSync(existingFile, "ORIGINAL_IMPORTANT_USER_DATA", "utf8");

      try {
        const res = await saveDesktopAppDocument({
          targetApp: "notepad",
          filePath: existingFile,
          expectedContent: "NEW_OVERWRITTEN_DATA",
          overwrite: false,
        });
        expect(res.success).toBe(false);
        expect(res.status).toBe("AWAITING_APPROVAL");
        expect(res.requiresApproval).toBe(true);
        expect(res.existingFileProtected).toBe(true);
        // Confirm original user data was untouched
        expect(fs.readFileSync(existingFile, "utf8")).toBe("ORIGINAL_IMPORTANT_USER_DATA");
      } finally {
        try {
          fs.unlinkSync(existingFile);
        } catch {
          /* ignore cleanup */
        }
      }
    });

    it("should detect save verification failures when saved disk content does not match expected content", () => {
      const tempFile = path.resolve("./data/phase8_1_verify_content_test.txt");
      fs.mkdirSync(path.dirname(tempFile), { recursive: true });
      fs.writeFileSync(tempFile, "Actual content written to disk", "utf8");

      try {
        // Mismatched content -> FAILED
        const mismatch = verifySavedDesktopFile(tempFile, "Expected completely different text");
        expect(mismatch.success).toBe(false);
        expect(mismatch.status).toBe("FAILED");
        expect(mismatch.fileExists).toBe(true);
        expect(mismatch.verified).toBe(false);

        // Matching content -> SUCCESS
        const matched = verifySavedDesktopFile(tempFile, "Actual content written to disk");
        expect(matched.success).toBe(true);
        expect(matched.status).toBe("SUCCESS");
        expect(matched.fileExists).toBe(true);
        expect(matched.verified).toBe(true);
      } finally {
        try {
          fs.unlinkSync(tempFile);
        } catch {
          /* ignore cleanup */
        }
      }

      // Missing file on disk -> FAILED
      const missing = verifySavedDesktopFile(path.resolve("./data/__missing_saved_file_8_1__.txt"), "hello");
      expect(missing.success).toBe(false);
      expect(missing.status).toBe("FAILED");
      expect(missing.fileExists).toBe(false);
      expect(missing.verified).toBe(false);
    });

    it("should invoke saveapp through PowerShell worker and report FAILED when target app window is missing", async () => {
      const targetFile = path.resolve("./data/phase8_1_nonexistent_app_save.txt");
      try {
        fs.unlinkSync(targetFile);
      } catch {
        /* ensure file does not exist */
      }

      const res = await saveDesktopAppDocument({
        targetApp: "__nonexistent_notepad_window_8_1__",
        filePath: targetFile,
        expectedContent: "Test save",
      });
      expect(res.success).toBe(false);
      expect(res.status).toBe("FAILED");
      expect(res.found).toBe(false);
      expect(fs.existsSync(targetFile)).toBe(false);
    }, 20000);

    it("should execute multiple sequential requests through one persistent PowerShell worker and beat cold-start latency", async () => {
      // Warm up worker
      const firstPing = await sendWorkerRpcRequest<{ success: boolean; action: string; pid: number }>("ping");
      expect(firstPing.success).toBe(true);
      const statsAfterFirst = getDesktopWorkerStats();
      expect(statsAfterFirst.isRunning).toBe(true);
      expect(statsAfterFirst.pid).not.toBeNull();

      // Run 3 sequential requests on the exact same warm worker process
      const tWarmStart = Date.now();
      const ping2 = await sendWorkerRpcRequest<{ success: boolean; pid: number }>("ping");
      const activeWin = await getActiveDesktopWindow();
      const ping3 = await sendWorkerRpcRequest<{ success: boolean; pid: number }>("ping");
      const warmAvgMs = (Date.now() - tWarmStart) / 3;

      const statsAfterBatch = getDesktopWorkerStats();
      expect(ping2.pid).toBe(firstPing.pid);
      expect(ping3.pid).toBe(firstPing.pid);
      expect(activeWin.success).toBe(true);
      expect(statsAfterBatch.pid).toBe(firstPing.pid);
      expect(statsAfterBatch.requestsHandled).toBeGreaterThanOrEqual(statsAfterFirst.requestsHandled + 3);

      // Compare against a cold PowerShell process invocation
      const tColdStart = Date.now();
      const coldWin = await runDesktopControlCold<{ success: boolean }>(["-Action", "getactivewindow"]);
      const coldMs = Date.now() - tColdStart;

      expect(coldWin.success).toBe(true);
      expect(warmAvgMs).toBeLessThan(coldMs);
    }, 25000);

    it("should survive malformed JSON-RPC requests without crashing the persistent worker", async () => {
      await sendWorkerRpcRequest("ping");
      const pidBefore = getDesktopWorkerStats().pid;

      const malformedRes = await sendRawWorkerLine("{malformed_json_payload_without_closing_brace");
      expect(malformedRes.error).toBeDefined();
      expect(malformedRes.error?.code).toBe(-32700);

      // Verify the exact same worker process is still alive and responsive
      const followUp = await sendWorkerRpcRequest<{ success: boolean; pid: number }>("ping");
      expect(followUp.success).toBe(true);
      expect(pidBefore).not.toBeNull();
      expect(followUp.pid).toBe(pidBefore as number);
    }, 15000);

    it("should enforce per-request worker timeouts and automatically restart the worker on subsequent requests", async () => {
      const initialPing = await sendWorkerRpcRequest<{ success: boolean; pid: number }>("ping");
      const oldPid = initialPing.pid;

      let timedOut = false;
      try {
        await sendWorkerRpcRequest("sleep", { SleepMs: 1500 }, 200);
      } catch (err) {
        timedOut = true;
        expect(err instanceof Error ? err.message : String(err)).toContain("timed out");
      }
      expect(timedOut).toBe(true);

      // Next request must automatically spawn a new worker process and succeed
      const recoveredPing = await sendWorkerRpcRequest<{ success: boolean; pid: number }>("ping");
      expect(recoveredPing.success).toBe(true);
      expect(recoveredPing.pid).not.toBe(oldPid);
      expect(getDesktopWorkerStats().restartCount).toBeGreaterThanOrEqual(1);
    }, 20000);

    it("should detect unexpected worker termination and automatically restart on next request", async () => {
      const beforeKill = await sendWorkerRpcRequest<{ success: boolean; pid: number }>("ping");
      const restartsBefore = getDesktopWorkerStats().restartCount;

      killDesktopWorkerForTest();

      const afterKill = await sendWorkerRpcRequest<{ success: boolean; pid: number }>("ping");
      expect(afterKill.success).toBe(true);
      expect(afterKill.pid).not.toBe(beforeKill.pid);
      expect(getDesktopWorkerStats().restartCount).toBeGreaterThanOrEqual(restartsBefore + 1);

      await shutdownDesktopWorker();
      expect(getDesktopWorkerStats().isRunning).toBe(false);
    }, 20000);
  });
});
