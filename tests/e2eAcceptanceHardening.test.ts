import { describe, expect, it } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { decomposeTask } from "../src/orchestration/universalPlan.js";
import { executeUniversalPlan, resumePausedPlan } from "../src/orchestration/universalExecutor.js";
import { browserSessionManager } from "../src/mcp/browser/sessionManager.js";
import { clearPendingActionApproval, getPendingActionApproval } from "../src/conversation/pendingIntentStore.js";
import { clearTaskContext } from "../src/conversation/taskContextStore.js";

describe("Universal Agent E2E Acceptance & Hardening", () => {
  it("1. REAL Filesystem E2E: Create folder, write file inside it, and verify contents via real dispatchTool", async () => {
    const tmpDir = path.join(os.tmpdir(), `creater_e2e_dir_${Date.now()}`);
    const plan = decomposeTask(
      `Create a folder ${tmpDir}, write a file hello.txt inside it, and verify its contents.`
    );

    expect(plan.actions.map((a) => a.type)).toEqual([
      "fs.create_directory",
      "fs.write_document",
      "fs.verify_file",
    ]);

    const writeAction = plan.actions[1]!;
    writeAction.params.content = "Creater AI E2E Verification Content";

    try {
      const res = await executeUniversalPlan(plan, { channel: "e2e-fs-1" });
      expect(res.success).toBe(true);
      expect(res.verified).toBe(true);

      const expectedFile = path.join(path.resolve(tmpDir), "hello.txt");
      expect(fs.existsSync(expectedFile)).toBe(true);
      expect(fs.readFileSync(expectedFile, "utf8")).toBe("Creater AI E2E Verification Content");
    } finally {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  });

  it("2. REAL Multi-MCP E2E: Executes os.system_info + filesystem.write_file + filesystem.read_file via real mcpCoordinator", async () => {
    const tmpFile = path.join(os.tmpdir(), `creater_mcp_e2e_${Date.now()}.txt`);
    const plan = decomposeTask("Check system info and save file");
    plan.actions = [
      {
        id: "mcp_1",
        type: "mcp.os.system_info",
        category: "information_retrieval",
        params: {},
        dependsOn: [],
        method: "mcp",
        fallbackMethods: [],
        expectedOutcome: "Retrieved OS info",
        requiresApproval: false,
        approvalState: "not_required",
        idempotent: true,
        timeoutMs: 10000,
        retryPolicy: { maxAttempts: 1, backoffMs: 100, allowRetryAfterSideEffect: false },
        status: "pending",
        verificationRequirement: "mcp_result_verified",
      },
      {
        id: "mcp_2",
        type: "mcp.filesystem.write_file",
        category: "file_operation",
        params: { path: tmpFile, content: "MCP E2E OK" },
        dependsOn: ["mcp_1"],
        method: "mcp",
        fallbackMethods: [],
        expectedOutcome: "Wrote file via MCP",
        requiresApproval: false,
        approvalState: "not_required",
        idempotent: true,
        timeoutMs: 10000,
        retryPolicy: { maxAttempts: 1, backoffMs: 100, allowRetryAfterSideEffect: false },
        status: "pending",
        verificationRequirement: "mcp_result_verified",
      },
      {
        id: "mcp_3",
        type: "mcp.filesystem.read_file",
        category: "file_operation",
        params: { path: tmpFile },
        dependsOn: ["mcp_2"],
        method: "mcp",
        fallbackMethods: [],
        expectedOutcome: "Read file via MCP",
        requiresApproval: false,
        approvalState: "not_required",
        idempotent: true,
        timeoutMs: 10000,
        retryPolicy: { maxAttempts: 1, backoffMs: 100, allowRetryAfterSideEffect: false },
        status: "pending",
        verificationRequirement: "mcp_result_verified",
      },
    ];

    try {
      const res = await executeUniversalPlan(plan, { channel: "e2e-mcp-1" });
      expect(res.success).toBe(true);
      expect(res.verified).toBe(true);
      expect(fs.readFileSync(tmpFile, "utf8")).toBe("MCP E2E OK");
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

  it("3. REAL Headless Browser + Filesystem E2E: Navigates data URL, extracts text, summarizes, saves to disk & verifies", async () => {
    const tmpFile = path.join(os.tmpdir(), `creater_browser_e2e_${Date.now()}.txt`);
    let tabId: string | undefined;

    try {
      tabId = await browserSessionManager.openPage();
      const htmlUrl = "data:text/html,<h1>AI Agent News</h1><p>Creater AI Universal Executor verified.</p>";
      await browserSessionManager.navigate(tabId, htmlUrl);
      const extracted = await browserSessionManager.extractText(tabId);

      const plan = decomposeTask("Summarize extracted content and save the summary in a document");
      plan.actions[0]!.params.sourceText = extracted;
      plan.actions[1]!.params.path = tmpFile;

      const res = await executeUniversalPlan(plan, { channel: "e2e-browser-1" });
      expect(res.success).toBe(true);
      expect(res.verified).toBe(true);
      expect(fs.readFileSync(tmpFile, "utf8")).toContain("Creater AI Universal Executor verified");
    } finally {
      if (tabId) await browserSessionManager.closeTab(tabId).catch(() => {});
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  }, 20000);

  it("4. Approval Lifecycle + Resume: Modification requires re-approval and resume NEVER repeats completed actions", async () => {
    const channel = "e2e-resume-1";
    const sessionId = "sess-resume-1";
    clearPendingActionApproval(channel);
    clearTaskContext(channel, sessionId);

    let playCalls = 0;
    let commentCalls = 0;
    let submittedComment = "";

    const toolDispatcher = async (toolId: string, params: Record<string, unknown>) => {
      if (toolId === "computer.play_youtube") {
        if (params.comment) {
          commentCalls += 1;
          submittedComment = String(params.comment);
          return `Playing "Stream 1" on YouTube and commented "${submittedComment}".`;
        }
        playCalls += 1;
        return `Playing "Stream 1" on YouTube.`;
      }
      throw new Error(`Unexpected tool ${toolId}`);
    };

    const plan = decomposeTask("Play CarryMinati's latest livestream on YouTube and comment 'Initial comment'");
    const p1 = await executeUniversalPlan(plan, { channel, sessionId, toolDispatcher });
    expect(p1.awaitingApproval).toBe(true);
    expect(playCalls).toBe(1);
    expect(commentCalls).toBe(0);

    // Modify parameter -> requires renewed approval, still does not execute
    const pMod = await resumePausedPlan(channel, "modified", {
      sessionId,
      modifiedParams: { commentText: "Updated Carry bhai comment!" },
      toolDispatcher,
    });
    expect(pMod?.awaitingApproval).toBe(true);
    expect(getPendingActionApproval(channel, sessionId)?.approvalState).toBe("modified");
    expect(commentCalls).toBe(0);

    // Approve -> resumes ONLY action_2 without repeating action_1
    const pApproved = await resumePausedPlan(channel, "approved", { sessionId, toolDispatcher });
    expect(pApproved?.success).toBe(true);
    expect(pApproved?.verified).toBe(true);
    expect(playCalls).toBe(1); // NEVER repeated!
    expect(commentCalls).toBe(1);
    expect(submittedComment).toBe("Updated Carry bhai comment!");

    clearPendingActionApproval(channel);
    clearTaskContext(channel, sessionId);
  });

  it("5. Timeout Enforcement & AbortSignal: Hanging tool call receives AbortSignal and records timed_out", async () => {
    const plan = decomposeTask("Search for hanging query");
    plan.actions[0]!.timeoutMs = 50;
    plan.actions[0]!.retryPolicy.maxAttempts = 1;

    let signalAborted = false;
    const res = await executeUniversalPlan(plan, {
      channel: "e2e-timeout-1",
      toolDispatcher: async (_id, _params, signal) =>
        new Promise((resolve) => {
          signal?.addEventListener("abort", () => {
            signalAborted = true;
          });
          setTimeout(() => resolve("late"), 500);
        }),
    });

    expect(res.success).toBe(false);
    expect(signalAborted).toBe(true);
    expect(plan.actions[0]?.status).toBe("timed_out");
    expect(plan.overallStatus).toBe("timed_out");
    expect(plan.actions[0]?.error).toContain("ACTION_TIMEOUT");
  });

  it("6. Repeated approval, rejection, and session isolation in resumePausedPlan", async () => {
    clearPendingActionApproval("tui", "iso-a");
    clearPendingActionApproval("tui", "iso-b");
    clearTaskContext("tui", "iso-a");
    clearTaskContext("tui", "iso-b");

    let callsA = 0;
    const dispatcherA = async (toolId: string, params: Record<string, unknown>) => {
      if (toolId === "computer.play_youtube" && params.comment) {
        callsA += 1;
        return `Playing "S1" on YouTube and commented "${String(params.comment)}".`;
      }
      return `Playing "S1" on YouTube.`;
    };

    const planA = decomposeTask("Play CarryMinati's latest livestream and comment 'Hello A'");
    const planB = decomposeTask("Play CarryMinati's latest livestream and comment 'Hello B'");

    await executeUniversalPlan(planA, { channel: "tui", sessionId: "iso-a", toolDispatcher: dispatcherA });
    await executeUniversalPlan(planB, { channel: "tui", sessionId: "iso-b", toolDispatcher: dispatcherA });

    // Approving session A succeeds once
    const resA1 = await resumePausedPlan("tui", "approved", { sessionId: "iso-a", toolDispatcher: dispatcherA });
    expect(resA1?.success).toBe(true);
    expect(callsA).toBe(1);

    // Repeated approval on session A does NOT re-execute!
    const resA2 = await resumePausedPlan("tui", "approved", { sessionId: "iso-a", toolDispatcher: dispatcherA });
    expect(resA2).toBeNull();
    expect(callsA).toBe(1);

    // Session B is isolated and still awaiting approval; rejecting it marks cancelled without executing
    const resB = await resumePausedPlan("tui", "rejected", { sessionId: "iso-b", toolDispatcher: dispatcherA });
    expect(resB?.success).toBe(false);
    expect(resB?.plan.actions[1]?.status).toBe("cancelled");
    expect(callsA).toBe(1);

    clearPendingActionApproval("tui", "iso-a");
    clearPendingActionApproval("tui", "iso-b");
    clearTaskContext("tui", "iso-a");
    clearTaskContext("tui", "iso-b");
  });
});
