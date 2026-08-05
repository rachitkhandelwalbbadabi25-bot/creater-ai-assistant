// src/tests/mcp/filesystem.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import {
  readFile,
  writeFile,
  createFolder,
  moveFile,
  searchFiles,
  listDirectory,
  validatePath,
  FileMCPError,
} from "../../mcp/filesystem/index.js";

const testRoot = path.join(process.cwd(), "test_sandbox");

beforeEach(() => {
  if (fs.existsSync(testRoot)) {
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
  fs.mkdirSync(testRoot, { recursive: true });
  process.env.FILE_ROOT = testRoot;
});

afterEach(() => {
  process.env.FILE_ROOT = "workspace";
  try {
    if (fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  } catch (_) {}
});

describe("Filesystem MCP", () => {
  it("writes and reads files", async () => {
    await writeFile("hello.txt", "hello world");
    const content = await readFile("hello.txt");
    expect(content).toBe("hello world");
  });

  it("handles atomic writes", async () => {
    await writeFile("atomic.txt", "atomic content", { atomic: true });
    const content = await readFile("atomic.txt");
    expect(content).toBe("atomic content");
  });

  it("creates folders", async () => {
    await createFolder("nested/dir");
    expect(fs.existsSync(path.join(testRoot, "nested", "dir"))).toBeTrue();
  });

  it("moves files", async () => {
    await writeFile("source.txt", "move me");
    await moveFile("source.txt", "destination.txt");
    expect(fs.existsSync(path.join(testRoot, "source.txt"))).toBeFalse();
    expect(await readFile("destination.txt")).toBe("move me");
  });

  it("lists directories", async () => {
    await writeFile("file1.txt", "1");
    await writeFile("file2.txt", "2");
    await createFolder("sub");

    const entries = await listDirectory(".");
    expect(entries.length).toBeGreaterThanOrEqual(3);
    const names = entries.map((e) => e.name);
    expect(names).toContain("file1.txt");
    expect(names).toContain("file2.txt");
    expect(names).toContain("sub");
  });

  it("searches files", async () => {
    await writeFile("search1.txt", "a");
    await writeFile("search2.log", "b");
    await createFolder("nested");
    await writeFile("nested/search3.txt", "c");

    // searchFiles does substring match, not glob matching in the original function implementation
    const txtMatches = await searchFiles("search");
    const names = txtMatches.map(r => r.name);
    expect(names).toHaveLength(3);
    expect(names).toContain("search1.txt");
    expect(names).toContain("search2.log");
    expect(names).toContain("search3.txt");
  });

  it("prevents sandbox escape", () => {
    expect(() => validatePath("../escape.txt")).toThrow();
    expect(() => validatePath("C:/System32/cmd.exe")).toThrow();
  });
});
