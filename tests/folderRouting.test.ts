import { describe, test, expect } from "bun:test";
import { routeFastCommand, isDeterministicLaunchIntent } from "../src/graph/commandRouter.js";
import { classifyRuntimeMode } from "../src/runtime/RuntimeModeClassifier.ts";
import { resolveSpecialFolder } from "../src/tools/laptop/folderResolver.js";

describe("Global Action vs Search Routing & Natural Folder Resolution Tests", () => {
  describe("1. Special Folder Resolver", () => {
    test("Resolves Screenshots folder variations", () => {
      expect(resolveSpecialFolder("screenshot folder")?.folderKey).toBe("screenshots");
      expect(resolveSpecialFolder("screenshots")?.folderKey).toBe("screenshots");
      expect(resolveSpecialFolder("my screenshots")?.folderKey).toBe("screenshots");
      expect(resolveSpecialFolder("the screenshots folder")?.folderKey).toBe("screenshots");
    });

    test("Resolves Documents folder variations", () => {
      expect(resolveSpecialFolder("documents")?.folderKey).toBe("documents");
      expect(resolveSpecialFolder("my documents")?.folderKey).toBe("documents");
      expect(resolveSpecialFolder("the documents folder")?.folderKey).toBe("documents");
    });

    test("Resolves Desktop, Pictures, Music, Videos, Downloads", () => {
      expect(resolveSpecialFolder("desktop")?.folderKey).toBe("desktop");
      expect(resolveSpecialFolder("pictures")?.folderKey).toBe("pictures");
      expect(resolveSpecialFolder("music")?.folderKey).toBe("music");
      expect(resolveSpecialFolder("videos")?.folderKey).toBe("videos");
      expect(resolveSpecialFolder("downloads")?.folderKey).toBe("downloads");
    });
  });

  describe("2. Fast Command Routing — Local Folder Actions", () => {
    test("'open screenshot folder' routes to open_path for Screenshots", () => {
      const res = routeFastCommand("open screenshot folder");
      expect(res?.kind).toBe("open_path");
      expect((res as any)?.path?.toLowerCase()).toContain("screenshots");
    });

    test("'open screenshots' routes to open_path for Screenshots", () => {
      const res = routeFastCommand("open screenshots");
      expect(res?.kind).toBe("open_path");
      expect((res as any)?.path?.toLowerCase()).toContain("screenshots");
    });

    test("'show me screenshot folder' routes to open_path for Screenshots", () => {
      const res = routeFastCommand("show me screenshot folder");
      expect(res?.kind).toBe("open_path");
      expect((res as any)?.path?.toLowerCase()).toContain("screenshots");
    });

    test("'go to screenshots' routes to open_path for Screenshots", () => {
      const res = routeFastCommand("go to screenshots");
      expect(res?.kind).toBe("open_path");
      expect((res as any)?.path?.toLowerCase()).toContain("screenshots");
    });

    test("'take me to screenshots' routes to open_path for Screenshots", () => {
      const res = routeFastCommand("take me to screenshots");
      expect(res?.kind).toBe("open_path");
      expect((res as any)?.path?.toLowerCase()).toContain("screenshots");
    });

    test("'find screenshot folder' routes to open_path for Screenshots", () => {
      const res = routeFastCommand("find screenshot folder");
      expect(res?.kind).toBe("open_path");
      expect((res as any)?.path?.toLowerCase()).toContain("screenshots");
    });

    test("'find my screenshots' routes to open_path for Screenshots", () => {
      const res = routeFastCommand("find my screenshots");
      expect(res?.kind).toBe("open_path");
      expect((res as any)?.path?.toLowerCase()).toContain("screenshots");
    });

    test("'open Documents' routes to open_path for Documents", () => {
      const res = routeFastCommand("open Documents");
      expect(res?.kind).toBe("open_path");
      expect((res as any)?.path?.toLowerCase()).toContain("documents");
    });

    test("'find the Downloads folder' routes to open_path for Downloads", () => {
      const res = routeFastCommand("find the Downloads folder");
      expect(res?.kind).toBe("open_path");
      expect((res as any)?.path?.toLowerCase()).toContain("downloads");
    });

    test("'find my Documents' routes to open_path for Documents", () => {
      const res = routeFastCommand("find my Documents");
      expect(res?.kind).toBe("open_path");
      expect((res as any)?.path?.toLowerCase()).toContain("documents");
    });
  });

  describe("3. Fast Command Routing — Web Search Preservation", () => {
    test("'search screenshot folder' returns null (goes to web search)", () => {
      const res = routeFastCommand("search screenshot folder");
      expect(res).toBeNull();
    });

    test("'search Google for screenshot folder' returns null or web search", () => {
      const res = routeFastCommand("search Google for screenshot folder");
      expect(res).toBeNull();
    });

    test("'find information about screenshot tools' returns null (goes to web search)", () => {
      const res = routeFastCommand("find information about screenshot tools");
      expect(res).toBeNull();
    });

    test("'find latest AI news' returns null (goes to web search)", () => {
      const res = routeFastCommand("find latest AI news");
      expect(res).toBeNull();
    });

    test("'look up AI agents' returns null (goes to web search)", () => {
      const res = routeFastCommand("look up AI agents");
      expect(res).toBeNull();
    });
  });

  describe("4. Runtime Mode Classification & LLM Bypass Verification", () => {
    test("'open screenshot folder' classifies as execution mode (bypasses LLM)", () => {
      const classification = classifyRuntimeMode("open screenshot folder");
      expect(classification.mode).toBe("execution");
      expect(classification.executionSource).toBe("direct-launch");
    });

    test("'find screenshot folder' classifies as execution mode (bypasses LLM)", () => {
      const classification = classifyRuntimeMode("find screenshot folder");
      expect(classification.mode).toBe("execution");
      expect(classification.executionSource).toBe("direct-launch");
    });

    test("'show me screenshot folder' classifies as execution mode (bypasses LLM)", () => {
      const classification = classifyRuntimeMode("show me screenshot folder");
      expect(classification.mode).toBe("execution");
      expect(classification.executionSource).toBe("direct-launch");
    });

    test("'find information about AI' is classified as web search or factual query", () => {
      const classification = classifyRuntimeMode("find information about AI");
      expect(classification.executionSource).not.toBe("direct-launch");
    });

    test("'show me latest AI news' is classified as search/time-sensitive, not direct launch", () => {
      const classification = classifyRuntimeMode("show me latest AI news");
      expect(classification.executionSource).not.toBe("direct-launch");
    });
  });

  describe("5. Existing Command Preservations", () => {
    test("'open Chrome' routes to open_app", () => {
      expect(routeFastCommand("open Chrome")).toEqual({ kind: "open_app", raw: "open Chrome", app: "chrome" });
    });

    test("'open Notepad' routes to open_app", () => {
      expect(routeFastCommand("open Notepad")).toEqual({ kind: "open_app", raw: "open Notepad", app: "notepad" });
    });

    test("'play CarryMinati videos on YouTube' routes to YouTube play", () => {
      const res = routeFastCommand("play CarryMinati videos on YouTube");
      expect(res?.kind).toBe("youtube");
      expect((res as any).action).toBe("play");
      expect((res as any).query).toBe("CarryMinati");
    });

    test("'volume up' routes to volume up", () => {
      expect(routeFastCommand("volume up")).toEqual({ kind: "volume", raw: "volume up", direction: "up" });
    });
  });
});
