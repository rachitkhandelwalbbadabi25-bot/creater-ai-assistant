import "./bunTestPolyfill.js";
import { describe, it, expect } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { dispatchTool } from "../src/tools/dispatcher.js";
import { evaluateCuaPolicy } from "../src/cua/cuaPolicy.js";
import { checkToolSafety } from "../src/tools/safety.js";
import { validatePath } from "../src/mcp/filesystem/fileOps.js";

describe("Phase 5.5 — OS MCP & Filesystem MCP Integration Tests", () => {
  const testDir = path.join(process.cwd(), "data", "checkpoints", "test_mcp_fs");

  it("1. Path validation prevents sandbox traversal attacks", () => {
    // Escape attempt using relative path traversal
    expect(() => validatePath("../../../secret.txt", { mustExist: false })).toThrow();
  });

  it("2. Filesystem CRUD operations execute safely through tool dispatcher", async () => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    const testFile = path.join(testDir, "test_write.txt");
    const moveDest = path.join(testDir, "test_moved.txt");
    const copyDest = path.join(testDir, "test_copied.txt");

    // Write file
    await dispatchTool("fs.write_file", { path: testFile, content: "Hello MCP Filesystem!" });
    expect(fs.existsSync(testFile)).toBe(true);

    // Read file
    const readContent = await dispatchTool("fs.read_file", { path: testFile });
    expect(readContent).toBe("Hello MCP Filesystem!");

    // Metadata inspection
    const meta = (await dispatchTool("fs.file_metadata", { path: testFile })) as any;
    expect(meta.isFile).toBe(true);
    expect(meta.sizeBytes).toBeGreaterThan(0);

    // Copy file
    await dispatchTool("fs.copy_file", { src: testFile, dest: copyDest });
    expect(fs.existsSync(copyDest)).toBe(true);

    // Move file
    await dispatchTool("fs.move_file", { src: testFile, dest: moveDest });
    expect(fs.existsSync(moveDest)).toBe(true);
    expect(fs.existsSync(testFile)).toBe(false);

    // Search files
    const searchResults = (await dispatchTool("fs.search_files", { query: "moved", base_dir: testDir })) as any[];
    expect(searchResults.some((r) => r.name.includes("moved"))).toBe(true);

    // Verify fs.delete_file enforces dangerous permission level in safety check
    const deleteSafety = checkToolSafety("fs.delete_file");
    expect(deleteSafety.requiresConfirmation).toBe(true);

    // Clean up test files directly
    if (fs.existsSync(moveDest)) fs.unlinkSync(moveDest);
    if (fs.existsSync(copyDest)) fs.unlinkSync(copyDest);
  });

  it("3. Directory creation and listing work cleanly via tool dispatcher", async () => {
    const subDir = path.join(testDir, "subdir_1");

    await dispatchTool("fs.create_directory", { path: subDir });
    expect(fs.existsSync(subDir)).toBe(true);

    const entries = (await dispatchTool("fs.list_directory", { path: testDir })) as any[];
    expect(entries.some((e) => e.name === "subdir_1" && e.isDirectory)).toBe(true);

    if (fs.existsSync(subDir)) fs.rmdirSync(subDir);
    expect(fs.existsSync(subDir)).toBe(false);
  });

  it("4. OS system info, process list, environment, and clipboard return valid data", async () => {
    // System info
    const info = (await dispatchTool("system.info", {})) as any;
    expect(info.cpu).toBeDefined();
    expect(info.ram).toBeDefined();

    // Process list
    const procs = (await dispatchTool("system.process_list", { top_n: 5 })) as any[];
    expect(Array.isArray(procs)).toBe(true);

    // Environment variables
    const envVars = (await dispatchTool("system.env", { keys: ["NODE_ENV"] })) as any;
    expect(envVars).toBeDefined();

    // Clipboard operation
    await dispatchTool("system.clipboard", { action: "write", text: "Creater AI Clipboard Test" });
    const readClip = await dispatchTool("system.clipboard", { action: "read" });
    expect(readClip).toBe("Creater AI Clipboard Test");
  });

  it("5. Protected PID process termination is blocked by safety checks", async () => {
    // Killing PID 1 or 4 should be rejected as a protected system process
    await expect(dispatchTool("system.process_kill", { pid: 4 })).rejects.toThrow();
  });

  it("6. CUA Policy prioritizes structured FS and OS tools over CUA fallback", () => {
    const fsPolicy = evaluateCuaPolicy({ toolId: "fs.copy_file" });
    expect(fsPolicy.targetLayer).toBe("NATIVE");
    expect(fsPolicy.decision).toBe("CUA_NOT_REQUIRED");

    const osPolicy = evaluateCuaPolicy({ toolId: "system.process_list" });
    expect(osPolicy.targetLayer).toBe("NATIVE");
    expect(osPolicy.decision).toBe("CUA_NOT_REQUIRED");
  });

  it("7. Dangerous and sensitive OS/FS operations correctly request supervisor confirmation", () => {
    const killSafety = checkToolSafety("system.process_kill");
    expect(killSafety.riskLevel).toBe("high");
    expect(killSafety.requiresConfirmation).toBe(true);

    const moveSafety = checkToolSafety("fs.move_file");
    expect(moveSafety.riskLevel).toBe("medium");
  });
});
