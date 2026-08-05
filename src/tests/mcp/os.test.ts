// src/tests/mcp/os.test.ts
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { openApp, clipboard, notifications, screenshot, processCheck, OsMCPError } from "../../mcp/os/index.js";
import { cleanupLaunchedProcesses } from "../../mcp/os/osOps.js";
import { browserSessionManager } from "../../mcp/browser/sessionManager.js";

describe("OS MCP", () => {
  it("allows spawning whitelisted binaries", async () => {
    // node is in the whitelist, we can spawn a simple node tick
    const pid = await openApp("node", ["-e", "setTimeout(() => {}, 1000)"]);
    expect(typeof pid).toBe("number");
    expect(pid).toBeGreaterThan(0);

    const check = processCheck(pid);
    expect(check.status).toBe("running");

    // Clean up
    try {
      process.kill(pid, "SIGTERM");
    } catch (_) {}
  });

  it("blocks non-whitelisted binaries", async () => {
    let err: any;
    try {
      await openApp("calc");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(OsMCPError);
    expect(err.code).toBe("SECURITY_VIOLATION");
  });

  it("performs clipboard read and write", async () => {
    const orig = await clipboard("read").catch(() => "");
    try {
      const written = await clipboard("write", "hello os mcp");
      expect(written).toBe("hello os mcp");
      const read = await clipboard("read");
      expect(read).toBe("hello os mcp");
    } finally {
      // restore original clipboard
      if (orig) {
        await clipboard("write", orig).catch(() => {});
      }
    }
  });

  it("sends notifications", async () => {
    const success = await notifications("Test Title", "Test Message");
    expect(typeof success).toBe("boolean");
  });

  it("captures screenshot and validates file exists", async () => {
    // Screenshot requires screen session, so on headless runner it might fail.
    // If it fails with support/graphics error, that's fine as long as we validate.
    try {
      const file = await screenshot();
      expect(fs.existsSync(file)).toBeTrue();
      expect(path.extname(file)).toBe(".png");
      // cleanup
      fs.unlinkSync(file);
    } catch (e: any) {
      // If platform is unsupported or headless, expect the error code
      expect(e).toBeInstanceOf(OsMCPError);
      expect(["SCREENSHOT_FAILED"]).toContain(e.code);
    }
  });

  it("checks process status correctly", () => {
    const check = processCheck(process.pid);
    expect(check.status).toBe("running");

    const checkExited = processCheck(999999); // nonexistent PID
    expect(checkExited.status).toBe("exited");
  });

  afterEach(async () => {
    await cleanupLaunchedProcesses?.();
    await browserSessionManager.cleanupAll?.();
  });
});
