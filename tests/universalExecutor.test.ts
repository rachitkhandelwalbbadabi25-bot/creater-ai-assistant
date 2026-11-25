import { describe, expect, it } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { executeUniversalPlan } from "../src/orchestration/universalExecutor.js";
import { decomposeTask, type UniversalExecutionPlan } from "../src/orchestration/universalPlan.js";
import {
  clearPendingActionApproval,
  getPendingActionApproval,
  setPendingActionApproval,
} from "../src/conversation/pendingIntentStore.js";
import { getTaskContext, clearTaskContext } from "../src/conversation/taskContextStore.js";
import { executionAgent } from "../src/agents/executionAgent.js";
import { verifierAgent } from "../src/agents/verifierAgent.js";
import { responseComposer } from "../src/agents/responseComposer.js";

describe("Universal Execution Engine (Milestone Completion)", () => {
  it("1. Executes multi-action browser + filesystem workflow with real disk verification & target continuity", async () => {
    const tmpFile = path.join(os.tmpdir(), `creater_exec_${Date.now()}.txt`);
    const plan = decomposeTask(
      "Open my browser, find the latest AI news, summarize the three most important articles, save the summary in a document, and open that document."
    );
    // Point action_4 to deterministic temp file
    const writeAction = plan.actions.find((a) => a.type === "fs.write_document")!;
    writeAction.params.path = tmpFile;

    const calls: string[] = [];
    try {
      const res = await executeUniversalPlan(plan, {
        channel: "test-exec-1",
        toolDispatcher: async (toolId, params) => {
          calls.push(toolId);
          if (toolId === "computer.open_browser") return { success: true, url: "https://www.google.com" };
          if (toolId === "browser.extract_text") return "Article 1: Agentic AI\nArticle 2: Local LLMs\nArticle 3: MCP";
          if (toolId === "fs.write_file") {
            fs.writeFileSync(String(params.path), String(params.content), "utf8");
            return { success: true, path: params.path };
          }
          if (toolId === "system.open_path") return { success: true, opened: params.path };
          throw new Error(`Unexpected tool ${toolId}`);
        },
      });

      expect(res.success).toBe(true);
      expect(res.verified).toBe(true);
      expect(calls).toEqual(["computer.open_browser", "browser.extract_text", "fs.write_file", "system.open_path"]);
      expect(plan.sharedContext.filePath).toBe(tmpFile);
      expect(plan.actions.every((a) => a.status === "completed" && a.evidence?.verified)).toBe(true);
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

  it("2. Executes desktop + browser workflow and preserves shared context", async () => {
    const plan: UniversalExecutionPlan = {
      planId: "plan_desk_browser",
      rawInput: "Open notepad and open browser",
      normalizedInput: "Open notepad and open browser",
      language: "english",
      script: "roman",
      intents: ["application_control", "navigation"],
      sharedContext: {},
      overallStatus: "pending",
      createdAt: Date.now(),
      actions: [
        {
          id: "a1",
          type: "system.open_app",
          category: "application_control",
          target: "notepad",
          params: { app: "notepad" },
          dependsOn: [],
          method: "native",
          fallbackMethods: ["cua"],
          expectedOutcome: "Notepad opened",
          requiresApproval: false,
          approvalState: "not_required",
          idempotent: true,
          timeoutMs: 5000,
          retryPolicy: { maxAttempts: 1, backoffMs: 100, allowRetryAfterSideEffect: false },
          status: "pending",
          verificationRequirement: "tool_result_verified",
        },
        {
          id: "a2",
          type: "browser.navigate",
          category: "navigation",
          target: "https://example.com",
          params: { url: "https://example.com" },
          dependsOn: ["a1"],
          method: "dom",
          fallbackMethods: ["cua"],
          expectedOutcome: "Navigated to example.com",
          requiresApproval: false,
          approvalState: "not_required",
          idempotent: true,
          timeoutMs: 5000,
          retryPolicy: { maxAttempts: 1, backoffMs: 100, allowRetryAfterSideEffect: false },
          status: "pending",
          verificationRequirement: "url_match",
        },
      ],
    };

    const res = await executeUniversalPlan(plan, {
      toolDispatcher: async (toolId) => ({ success: true, toolId }),
    });
    expect(res.success).toBe(true);
    expect(plan.sharedContext.url).toBe("https://example.com");
  });

  it("3. Executes MCP tools via mcpCaller and verifies MCP result", async () => {
    const plan: UniversalExecutionPlan = {
      planId: "plan_mcp",
      rawInput: "Call os.system_info",
      normalizedInput: "Call os.system_info",
      language: "english",
      script: "roman",
      intents: ["information_retrieval"],
      sharedContext: {},
      overallStatus: "pending",
      createdAt: Date.now(),
      actions: [
        {
          id: "m1",
          type: "mcp.os.system_info",
          category: "information_retrieval",
          params: {},
          dependsOn: [],
          method: "mcp",
          fallbackMethods: [],
          expectedOutcome: "System info retrieved",
          requiresApproval: false,
          approvalState: "not_required",
          idempotent: true,
          timeoutMs: 5000,
          retryPolicy: { maxAttempts: 1, backoffMs: 100, allowRetryAfterSideEffect: false },
          status: "pending",
          verificationRequirement: "mcp_result_verified",
        },
      ],
    };

    const res = await executeUniversalPlan(plan, {
      mcpCaller: async (serverName, toolName) => ({
        success: true,
        serverName,
        toolName,
        durationMs: 4,
        data: { platform: "win32" },
      }),
    });
    expect(res.success).toBe(true);
    expect(res.verified).toBe(true);
    expect(plan.actions[0]?.evidence?.method).toBe("mcp_result_verified");
  });

  it("4. Executes independent idempotent actions in parallel while respecting dependencies", async () => {
    const active: string[] = [];
    let maxConcurrent = 0;

    const plan: UniversalExecutionPlan = {
      planId: "plan_parallel",
      rawInput: "Parallel search then summarize",
      normalizedInput: "Parallel search then summarize",
      language: "english",
      script: "roman",
      intents: ["web_search", "summarization"],
      sharedContext: {},
      overallStatus: "pending",
      createdAt: Date.now(),
      actions: [
        {
          id: "p1",
          type: "browser.search",
          category: "web_search",
          params: { query: "topic A" },
          dependsOn: [],
          method: "dom",
          fallbackMethods: [],
          expectedOutcome: "Search A",
          requiresApproval: false,
          approvalState: "not_required",
          idempotent: true,
          timeoutMs: 5000,
          retryPolicy: { maxAttempts: 1, backoffMs: 10, allowRetryAfterSideEffect: false },
          status: "pending",
          verificationRequirement: "tool_result_verified",
        },
        {
          id: "p2",
          type: "browser.search",
          category: "web_search",
          params: { query: "topic B" },
          dependsOn: [],
          method: "dom",
          fallbackMethods: [],
          expectedOutcome: "Search B",
          requiresApproval: false,
          approvalState: "not_required",
          idempotent: true,
          timeoutMs: 5000,
          retryPolicy: { maxAttempts: 1, backoffMs: 10, allowRetryAfterSideEffect: false },
          status: "pending",
          verificationRequirement: "tool_result_verified",
        },
        {
          id: "p3",
          type: "content.summarize",
          category: "summarization",
          targetFromStep: "p1",
          params: { instruction: "summarize" },
          dependsOn: ["p1", "p2"],
          method: "llm",
          fallbackMethods: [],
          expectedOutcome: "Summary",
          requiresApproval: false,
          approvalState: "not_required",
          idempotent: true,
          timeoutMs: 5000,
          retryPolicy: { maxAttempts: 1, backoffMs: 10, allowRetryAfterSideEffect: false },
          status: "pending",
          verificationRequirement: "non_empty_output",
        },
      ],
    };

    const res = await executeUniversalPlan(plan, {
      maxConcurrency: 3,
      toolDispatcher: async (_toolId, params) => {
        const q = String(params.url);
        active.push(q);
        maxConcurrent = Math.max(maxConcurrent, active.length);
        await new Promise((r) => setTimeout(r, 25));
        active.splice(active.indexOf(q), 1);
        return `Results for ${q}`;
      },
    });

    expect(res.success).toBe(true);
    expect(maxConcurrent).toBe(2);
    expect(plan.actions[2]?.status).toBe("completed");
  });

  it("5. Enforces approval gate, preserves target, and executes after explicit approval", async () => {
    const channel = "test-approval-exec";
    clearPendingActionApproval(channel);

    const plan = decomposeTask("Play CarryMinati's latest livestream on YouTube and comment 'Carry bhai, big fan bro!'");

    // Pass 1: Plays video, pauses at comment awaiting_approval
    const pass1 = await executeUniversalPlan(plan, {
      channel,
      toolDispatcher: async (toolId, params) => {
        if (toolId === "computer.play_youtube") {
          return `Playing "BGMI LATE NIGHT STREAM" on YouTube.`;
        }
        throw new Error(`Unexpected tool ${toolId} with ${JSON.stringify(params)}`);
      },
    });

    expect(pass1.awaitingApproval).toBe(true);
    expect(plan.overallStatus).toBe("partially_completed");
    expect(plan.actions[0]?.status).toBe("completed");
    expect(plan.actions[1]?.status).toBe("awaiting_approval");

    const pending = getPendingActionApproval(channel);
    expect(pending?.targetTitle).toBe("BGMI LATE NIGHT STREAM");
    expect(pending?.params.commentText).toBe("Carry bhai, big fan bro!");

    // Pass 2: Simulate user approving the pending action
    setPendingActionApproval(channel, { ...pending!, approvalState: "approved" });
    plan.actions[1]!.status = "pending";

    const pass2 = await executeUniversalPlan(plan, {
      channel,
      toolDispatcher: async (_toolId, params) => {
        expect(params.approved).toBe(true);
        expect(params.comment).toBe("Carry bhai, big fan bro!");
        return `Playing "BGMI LATE NIGHT STREAM" on YouTube and commented "Carry bhai, big fan bro!".`;
      },
    });

    expect(pass2.success).toBe(true);
    expect(pass2.verified).toBe(true);
    expect(String(plan.actions[1]?.status)).toBe("completed");
    clearPendingActionApproval(channel);
  });

  it("6. Retries idempotent failures safely and NEVER retries non-idempotent side effects", async () => {
    let idempotentAttempts = 0;
    let sideEffectAttempts = 0;

    const plan: UniversalExecutionPlan = {
      planId: "plan_retry",
      rawInput: "Retry test",
      normalizedInput: "Retry test",
      language: "english",
      script: "roman",
      intents: ["web_search", "social_media_action"],
      sharedContext: { title: "Target Video" },
      overallStatus: "pending",
      createdAt: Date.now(),
      actions: [
        {
          id: "r1",
          type: "browser.search",
          category: "web_search",
          params: { query: "test" },
          dependsOn: [],
          method: "dom",
          fallbackMethods: [],
          expectedOutcome: "Search succeeded",
          requiresApproval: false,
          approvalState: "not_required",
          idempotent: true,
          timeoutMs: 5000,
          retryPolicy: { maxAttempts: 2, backoffMs: 10, allowRetryAfterSideEffect: false },
          status: "pending",
          verificationRequirement: "tool_result_verified",
        },
        {
          id: "r2",
          type: "youtube.comment",
          category: "social_media_action",
          params: { commentText: "Nice!" },
          dependsOn: ["r1"],
          method: "dom",
          fallbackMethods: [],
          expectedOutcome: "Comment posted",
          requiresApproval: false,
          approvalState: "approved",
          idempotent: false,
          timeoutMs: 5000,
          retryPolicy: { maxAttempts: 3, backoffMs: 10, allowRetryAfterSideEffect: false },
          status: "pending",
          verificationRequirement: "youtube_comment_published",
        },
      ],
    };

    const res = await executeUniversalPlan(plan, {
      allowApprovalBypass: true,
      toolDispatcher: async (toolId) => {
        if (toolId === "browser.extract_text") {
          idempotentAttempts += 1;
          if (idempotentAttempts === 1) throw new Error("Transient network error");
          return "Search result OK";
        }
        if (toolId === "computer.play_youtube") {
          sideEffectAttempts += 1;
          throw new Error("Timeout after submit");
        }
        return null;
      },
    });

    expect(idempotentAttempts).toBe(2);
    expect(sideEffectAttempts).toBe(1); // Non-idempotent side effect MUST NOT retry blindly
    expect(plan.actions[0]?.status).toBe("completed");
    expect(plan.actions[1]?.status).toBe("failed");
    expect(res.plan.overallStatus).toBe("partially_completed");
  });

  it("7. Skips downstream dependents on failure while preserving partial completion", async () => {
    const plan = decomposeTask(
      "Open my browser, find AI news, summarize it, save the summary in a document, and open that document."
    );

    const res = await executeUniversalPlan(plan, {
      toolDispatcher: async (toolId) => {
        if (toolId === "computer.open_browser") return { success: true };
        if (toolId === "browser.extract_text") throw new Error("Network offline");
        throw new Error(`Should not have called ${toolId}`);
      },
    });

    expect(res.success).toBe(false);
    expect(plan.overallStatus).toBe("partially_completed");
    expect(plan.actions[0]?.status).toBe("completed");
    expect(plan.actions[1]?.status).toBe("failed");
    expect(plan.actions[2]?.status).toBe("skipped");
    expect(plan.actions[3]?.status).toBe("skipped");
    expect(plan.actions[4]?.status).toBe("skipped");
  });

  it("8. Fails cleanly on unknown/unregistered action types and verification failures", async () => {
    const plan: UniversalExecutionPlan = {
      planId: "plan_unknown",
      rawInput: "Unknown action",
      normalizedInput: "Unknown action",
      language: "english",
      script: "roman",
      intents: ["multi_step_workflow"],
      sharedContext: {},
      overallStatus: "pending",
      createdAt: Date.now(),
      actions: [
        {
          id: "u1",
          type: "nonexistent.magic_tool",
          category: "multi_step_workflow",
          params: {},
          dependsOn: [],
          method: "native",
          fallbackMethods: [],
          expectedOutcome: "Should fail",
          requiresApproval: false,
          approvalState: "not_required",
          idempotent: true,
          timeoutMs: 5000,
          retryPolicy: { maxAttempts: 1, backoffMs: 10, allowRetryAfterSideEffect: false },
          status: "pending",
          verificationRequirement: "tool_result_verified",
        },
      ],
    };

    const res = await executeUniversalPlan(plan);
    expect(res.success).toBe(false);
    expect(plan.actions[0]?.status).toBe("failed");
    expect(plan.actions[0]?.error).toContain("UNKNOWN_ACTION_OR_TOOL");
  });

  it("9. Records task context and integrates with executionAgent -> verifierAgent -> responseComposer", async () => {
    clearTaskContext("tui", "agent-pipe-1");
    const plan = decomposeTask("Open notepad");
    plan.actions[0]!.type = "system.open_app";
    plan.actions[0]!.params = { app: "notepad" };

    // Verify executionAgent -> verifierAgent -> responseComposer wiring with a mock-safe plan
    const execRes = await executionAgent({
      requestId: "agent-pipe-1",
      executionMode: "multi-agent",
      plannerAgentOutput: {
        goal: "Unknown step test",
        complexity: "low",
        requiredAgents: ["executionAgent", "verifierAgent", "responseComposer"],
        steps: ["Unknown step"],
        universalPlan: {
          ...plan,
          actions: [
            {
              ...plan.actions[0]!,
              type: "unknown.unsupported_tool",
            },
          ],
        },
      },
    } as unknown as import("../src/orchestration/agentSharedContext.js").AgentSharedContext);

    expect(execRes.result.success).toBe(false);
    expect(execRes.result.universalPlan?.overallStatus).toBe("failed");

    const verRes = await verifierAgent({
      requestId: "agent-pipe-1",
      executionMode: "multi-agent",
      executionAgentOutput: execRes.result,
    } as unknown as import("../src/orchestration/agentSharedContext.js").AgentSharedContext);
    expect(verRes.result.success).toBe(false);
    expect(verRes.result.verified).toBe(false);
    expect(verRes.result.issues.length).toBeGreaterThan(0);

    const compRes = await responseComposer({
      requestId: "agent-pipe-1",
      executionMode: "multi-agent",
      executionAgentOutput: execRes.result,
      verifierAgentOutput: verRes.result,
    } as unknown as import("../src/orchestration/agentSharedContext.js").AgentSharedContext);
    expect(compRes.result).toContain("Execution failed");
    expect(getTaskContext("tui", "agent-pipe-1")?.failedActions.length).toBe(1);
  });
});
