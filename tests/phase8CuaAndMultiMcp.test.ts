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
      try { fs.unlinkSync(tempPath); } catch {}

      // 2. OS MCP
      const osRes = await mcpCoordinator.callTool("os", "system_info", {});
      expect(osRes.success).toBe(true);
      expect((osRes.data as any)?.os).toBeDefined();

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

      try { fs.unlinkSync(pipelineFilePath); } catch {}

      expect(pipeline.success).toBe(true);
      expect(pipeline.stepResults.length).toBe(4);
      expect(pipeline.context.readResult).toBe("Pipeline Phase 8 Verified");
      expect((pipeline.context.sysInfo as any)?.os).toBeDefined();
    }, 15000);
  });

  describe("6. Dispatcher Integration & Auto-Tracing", () => {
    it("dispatches mcp.list_servers and cua.active_window via global dispatcher", async () => {
      const serverList = (await dispatchTool("mcp.list_servers", {})) as any[];
      expect(Array.isArray(serverList)).toBe(true);
      expect(serverList.some((s) => s.name === "desktop")).toBe(true);

      const activeWin = (await dispatchTool("cua.active_window", {})) as any;
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
  });
});
