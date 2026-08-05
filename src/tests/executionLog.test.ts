// src/tests/executionLog.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { logExecution, logWorkflow, logBrowser, logError, LOG_FILES } from "../observability/executionLog.js";
import * as fs from "fs";
import * as path from "path";

const logsRoot = path.resolve("logs");

beforeEach(() => {
  if (fs.existsSync(logsRoot)) {
    fs.rmSync(logsRoot, { recursive: true, force: true });
  }
});

describe("ExecutionLog", () => {
  it("creates directories and writes a JSONL entry", () => {
    logExecution({ action: "start", status: "running", module: "test" });
    const content = fs.readFileSync(LOG_FILES.execution, "utf8").trim();
    const line = JSON.parse(content);
    expect(line.action).toBe("start");
    expect(line.module).toBe("test");
    expect(line.status).toBe("running");
    expect(typeof line.timestamp).toBe("string");
  });

  it("appends multiple entries and serializes errors", () => {
    logWorkflow({ action: "step1", status: "success", module: "wf" });
    logWorkflow({
      action: "step2",
      status: "failed",
      module: "wf",
      error: new Error("boom"),
    });
    const lines = fs.readFileSync(LOG_FILES.workflow, "utf8").trim().split(/\n/);
    expect(lines).toHaveLength(2);
    const second = JSON.parse(lines[1]);
    expect(second.error).toMatchObject({ name: "Error", message: "boom" });
  });
});
