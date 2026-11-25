// ════════════════════════════════════════════════════════════════════════════════
// src/orchestration/universalExecutor.ts — Universal Plan Execution Engine
// Executes UniversalExecutionPlan actions in dependency order (sequential & safe
// parallel), dispatches through registered tools & MCP, enforces approval gates,
// verifies outcomes with evidence, and isolates failures for partial recovery.
// ════════════════════════════════════════════════════════════════════════════════

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createLogger } from "@utils/logger.js";
import { dispatchTool } from "../tools/dispatcher.js";
import { mcpCoordinator } from "../mcp/coordinator.js";
import type { McpExecutionResult } from "../mcp/types.js";
import { verifySavedDesktopFile } from "../tools/laptop/desktopControl.js";
import {
  setPendingActionApproval,
  getPendingActionApproval,
  clearPendingActionApproval,
  revalidatePendingApproval,
} from "../conversation/pendingIntentStore.js";
import { getTaskContext, recordPlanExecution } from "../conversation/taskContextStore.js";
import {
  validateExecutionPlan,
  computePlanOverallStatus,
  formatPlanExecutionSummary,
  type PlannedAction,
  type SharedTargetContext,
  type UniversalExecutionPlan,
  type VerificationEvidence,
} from "./universalPlan.js";

const log = createLogger("orchestration/universalExecutor");

export type ToolDispatcherFn = (
  toolId: string,
  params: Record<string, unknown>,
  signal?: AbortSignal
) => Promise<unknown>;
export type McpCallerFn = (
  serverName: string,
  toolName: string,
  params: Record<string, unknown>,
  signal?: AbortSignal
) => Promise<McpExecutionResult>;
export type SummarizerFn = (instruction: string, sourceText: string) => Promise<string>;
export type ActionVerifierFn = (
  action: PlannedAction,
  output: unknown,
  sharedContext: SharedTargetContext
) => Promise<VerificationEvidence>;

export interface UniversalExecutorOptions {
  channel?: string;
  sessionId?: string;
  toolDispatcher?: ToolDispatcherFn;
  mcpCaller?: McpCallerFn;
  summarizer?: SummarizerFn;
  verifier?: ActionVerifierFn;
  maxConcurrency?: number;
  allowApprovalBypass?: boolean;
  cancelledActionIds?: Set<string>;
  cancellationSignal?: AbortSignal;
}

export interface UniversalExecutionResult {
  plan: UniversalExecutionPlan;
  success: boolean;
  verified: boolean;
  awaitingApproval: boolean;
  summary: string;
  durationMs: number;
}

function getSourceActionOutput(plan: UniversalExecutionPlan, stepId?: string): unknown {
  if (!stepId) return undefined;
  return plan.actions.find((a) => a.id === stepId)?.result;
}

function extractTextFromOutput(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof output === "object") {
    const rec = output as Record<string, unknown>;
    if (typeof rec.text === "string") return rec.text;
    if (typeof rec.summary === "string") return rec.summary;
    if (typeof rec.content === "string") return rec.content;
    if (typeof rec.message === "string") return rec.message;
    if (typeof rec.response === "string") return rec.response;
    if (rec.data !== undefined) return extractTextFromOutput(rec.data);
  }
  return "";
}

/**
 * Action-specific evidence verifier. Never blindly returns verified=true.
 */
export async function defaultActionVerifier(
  action: PlannedAction,
  output: unknown,
  sharedContext: SharedTargetContext
): Promise<VerificationEvidence> {
  const timestamp = Date.now();

  if (action.type === "fs.create_directory") {
    const dirPath = String((output as { path?: string } | undefined)?.path || action.params.path || "");
    const exists = Boolean(dirPath && fs.existsSync(path.resolve(dirPath)));
    return {
      verified: exists,
      status: exists ? "VERIFIED" : "NOT_VERIFIED",
      method: "directory_exists",
      expected: dirPath || "created directory",
      observed: exists ? `Directory exists at ${path.resolve(dirPath)}` : "Directory not found",
      reason: exists ? "Directory existence verified on disk." : "Directory not found on disk.",
      timestamp,
    };
  }

  if (action.type === "fs.write_document" || action.type === "fs.write_file" || action.type === "fs.verify_file") {
    const filePath = String(
      (output as { filePath?: string } | undefined)?.filePath ||
        action.params.path ||
        sharedContext.filePath ||
        ""
    );
    const expectedContent = typeof action.params.content === "string" ? action.params.content : undefined;
    const diskCheck = verifySavedDesktopFile(filePath, expectedContent);
    return {
      verified: Boolean(diskCheck.success && diskCheck.verified),
      status: diskCheck.verified ? "VERIFIED" : "NOT_VERIFIED",
      method: "file_exists",
      expected: filePath || "saved file on disk",
      observed: diskCheck.fileExists ? `File exists at ${diskCheck.filePath}` : diskCheck.error || "File not found",
      reason: diskCheck.verified ? "File existence and content verified on disk." : diskCheck.error || "File verification failed.",
      timestamp,
    };
  }

  if (action.type === "system.open_path") {
    const filePath = String(action.params.path || sharedContext.filePath || "");
    const diskCheck = filePath ? verifySavedDesktopFile(filePath) : undefined;
    const ok = Boolean(diskCheck?.fileExists) && output !== false;
    return {
      verified: ok,
      status: ok ? "VERIFIED" : "NOT_VERIFIED",
      method: "file_opened",
      expected: filePath || "target path",
      observed: ok ? `Opened ${filePath}` : "Target path could not be verified.",
      reason: ok ? "Target path verified on disk and opened." : "Target path missing or failed to open.",
      timestamp,
    };
  }

  if (action.type === "youtube.select_and_play") {
    const text = extractTextFromOutput(output);
    const failedMatch = /could not verify|could not find|failed/i.test(text);
    const playingMatch = /playing\s+"([^"]+)"/i.test(text);
    return {
      verified: playingMatch && !failedMatch,
      status: playingMatch && !failedMatch ? "VERIFIED" : "NOT_VERIFIED",
      method: "youtube_playback_verified",
      expected: action.expectedOutcome,
      observed: text || "No playback output",
      reason:
        playingMatch && !failedMatch
          ? "YouTube video selected and playback initiated."
          : text || "Playback could not be verified.",
      timestamp,
    };
  }

  if (action.type === "youtube.comment") {
    const text = extractTextFromOutput(output);
    const rec = output && typeof output === "object" ? (output as Record<string, unknown>) : undefined;
    const verified =
      rec?.verified === true ||
      (/and commented "/i.test(text) && !/could not|partial_success|awaiting_approval|cancelled/i.test(text));
    return {
      verified,
      status: verified ? "VERIFIED" : "NOT_VERIFIED",
      method: "youtube_comment_published",
      expected: `Published comment: ${String(action.params.commentText || "")}`,
      observed: text || JSON.stringify(output ?? ""),
      reason: verified ? "Comment publication verified." : text || "Comment publication not verified.",
      timestamp,
    };
  }

  if (action.type.startsWith("mcp.") || (action.params.mcpServer && action.params.mcpTool)) {
    const rec = output as McpExecutionResult | undefined;
    const ok = Boolean(rec && rec.success === true);
    return {
      verified: ok,
      status: ok ? "VERIFIED" : "NOT_VERIFIED",
      method: "mcp_result_verified",
      expected: action.expectedOutcome,
      observed: ok ? `MCP ${rec?.serverName}.${rec?.toolName} succeeded` : rec?.error || "MCP call failed",
      reason: ok ? "MCP tool returned success=true." : rec?.error || "MCP tool returned failure.",
      timestamp,
    };
  }

  if (action.type === "content.summarize" || action.type === "web.compare_prices") {
    const text = extractTextFromOutput(output).trim();
    const ok = text.length > 0;
    return {
      verified: ok,
      status: ok ? "VERIFIED" : "NOT_VERIFIED",
      method: "non_empty_output",
      expected: "Non-empty summary/comparison output",
      observed: ok ? text.slice(0, 140) : "Empty output",
      reason: ok ? "Non-empty summary produced." : "Summarizer produced empty output.",
      timestamp,
    };
  }

  // Generic check: must have non-null output without success:false or error
  if (output === null || output === undefined) {
    return {
      verified: false,
      status: "NOT_VERIFIED",
      method: "tool_result_verified",
      expected: action.expectedOutcome,
      observed: "null/undefined",
      reason: "Tool returned empty result.",
      timestamp,
    };
  }

  if (typeof output === "object" && (output as { success?: boolean }).success === false) {
    const err = (output as { error?: string }).error || "Tool returned success=false";
    return {
      verified: false,
      status: "NOT_VERIFIED",
      method: "tool_result_verified",
      expected: action.expectedOutcome,
      observed: err,
      reason: err,
      timestamp,
    };
  }

  return {
    verified: true,
    status: "VERIFIED",
    method: "tool_result_verified",
    expected: action.expectedOutcome,
    observed: extractTextFromOutput(output).slice(0, 140) || "Completed",
    reason: "Tool returned valid output.",
    timestamp,
  };
}

async function dispatchSingleAction(
  action: PlannedAction,
  plan: UniversalExecutionPlan,
  deps: {
    toolDispatcher: ToolDispatcherFn;
    mcpCaller: McpCallerFn;
    summarizer: SummarizerFn;
    signal?: AbortSignal;
  }
): Promise<unknown> {
  const { toolDispatcher, mcpCaller, summarizer, signal } = deps;
  if (signal?.aborted) {
    throw new Error(`ACTION_CANCELLED: Action ${action.id} aborted before dispatch.`);
  }
  const sourceOutput = getSourceActionOutput(plan, action.targetFromStep);

  // Explicit MCP action: "mcp.<server>.<tool>" or params.mcpServer + params.mcpTool
  if (action.type.startsWith("mcp.") || (action.params.mcpServer && action.params.mcpTool)) {
    const parts = action.type.startsWith("mcp.") ? action.type.slice(4).split(".") : [];
    const server = String(action.params.mcpServer || parts[0] || "");
    const tool = String(action.params.mcpTool || parts.slice(1).join(".") || "");
    if (!server || !tool) {
      throw new Error(`Invalid MCP action specification: ${action.type}`);
    }
    const res = await mcpCaller(
      server,
      tool,
      (action.params.mcpParams as Record<string, unknown>) || action.params,
      signal
    );
    if (!res.success) {
      throw new Error(res.error || `MCP tool ${server}.${tool} failed`);
    }
    return res;
  }

  switch (action.type) {
    case "browser.open": {
      const res = await toolDispatcher(
        "computer.open_browser",
        { url: action.params.url || "https://www.google.com" },
        signal
      );
      plan.sharedContext.targetType = "url";
      plan.sharedContext.url = String(action.params.url || "https://www.google.com");
      return res;
    }

    case "browser.navigate": {
      const url = String(action.params.url || action.target || plan.sharedContext.url || "https://www.google.com");
      const res = await toolDispatcher("browser.navigate", { url }, signal);
      plan.sharedContext.targetType = "url";
      plan.sharedContext.url = url;
      return res;
    }

    case "browser.search": {
      const query = String(action.params.query || action.target || "");
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      const res = await toolDispatcher("browser.extract_text", { url: searchUrl }, signal);
      plan.sharedContext.targetType = "url";
      plan.sharedContext.url = searchUrl;
      plan.sharedContext.title = query;
      return res;
    }

    case "content.summarize":
    case "web.compare_prices": {
      const sourceText =
        extractTextFromOutput(sourceOutput) ||
        String(action.params.sourceText || plan.sharedContext.metadata?.extractedText || "");
      const instruction = String(action.params.instruction || action.expectedOutcome);
      const summary = await summarizer(instruction, sourceText);
      plan.sharedContext.metadata = {
        ...plan.sharedContext.metadata,
        lastSummary: summary,
      };
      return { success: true, summary };
    }

    case "fs.create_directory": {
      const dirPath = String(action.params.path || action.target || "");
      if (!dirPath) throw new Error("Missing directory path for fs.create_directory.");
      const resolvedDir = path.resolve(dirPath);
      const res = await toolDispatcher("fs.create_directory", { path: resolvedDir });
      plan.sharedContext.metadata = {
        ...plan.sharedContext.metadata,
        directory: resolvedDir,
      };
      return { ...(typeof res === "object" && res ? res : { result: res }), path: resolvedDir };
    }

    case "fs.write_document":
    case "fs.write_file": {
      const content =
        (typeof action.params.content === "string" ? action.params.content : undefined) ||
        extractTextFromOutput(sourceOutput) ||
        String(plan.sharedContext.metadata?.lastSummary || action.params.instruction || "");
      const parentDir =
        typeof plan.sharedContext.metadata?.directory === "string"
          ? plan.sharedContext.metadata.directory
          : os.tmpdir();
      const fileName =
        (typeof action.params.fileName === "string" && action.params.fileName.trim()) ||
        `creater_doc_${Date.now()}.txt`;
      const targetPath =
        (typeof action.params.path === "string" && action.params.path.trim()) ||
        path.join(parentDir, fileName);
      action.params.path = targetPath;
      action.params.content = content;
      const res = await toolDispatcher("fs.write_file", { path: targetPath, content });
      plan.sharedContext.targetType = "file";
      plan.sharedContext.filePath = targetPath;
      return { ...(typeof res === "object" && res ? res : { result: res }), filePath: targetPath };
    }

    case "fs.verify_file": {
      const targetPath = String(
        action.params.path ||
          (sourceOutput as { filePath?: string } | undefined)?.filePath ||
          plan.sharedContext.filePath ||
          ""
      );
      if (!targetPath) throw new Error("No target file path available to verify.");
      action.params.path = targetPath;
      const readRes = await toolDispatcher("fs.read_file", { path: targetPath });
      return { ...(typeof readRes === "object" && readRes ? readRes : { content: readRes }), filePath: targetPath };
    }

    case "system.open_path": {
      const targetPath = String(
        action.params.path ||
          (sourceOutput as { filePath?: string } | undefined)?.filePath ||
          plan.sharedContext.filePath ||
          action.target ||
          ""
      );
      if (!targetPath) {
        throw new Error("No target file path available to open.");
      }
      action.params.path = targetPath;
      return toolDispatcher("system.open_path", { path: targetPath });
    }

    case "system.open_app": {
      const app = String(action.params.app || action.target || "");
      const res = await toolDispatcher("system.open_app", { app });
      plan.sharedContext.targetType = "app";
      plan.sharedContext.app = app;
      return res;
    }

    case "youtube.select_and_play":
    case "youtube.search":
    case "youtube.open_channel": {
      const query = String(action.params.query || action.target || "");
      const ytAction = action.type === "youtube.search" ? "search" : "play";
      const res = await toolDispatcher("computer.play_youtube", {
        query,
        action: ytAction,
        selection: "first",
        mediaSubtype: action.params.mediaSubtype || "video",
      });
      const text = extractTextFromOutput(res);
      const titleMatch = text.match(/Playing "([^"]+)" on YouTube/);
      plan.sharedContext.targetType = "youtube_video";
      plan.sharedContext.title = titleMatch?.[1] || query;
      plan.sharedContext.channelName = query;
      return res;
    }

    case "youtube.comment": {
      const targetQuery = String(
        plan.sharedContext.title ||
          action.target ||
          (typeof sourceOutput === "string" ? sourceOutput : "") ||
          ""
      );
      const commentText = String(action.params.commentText || "");
      if (!commentText) {
        throw new Error("Missing comment text for youtube.comment action.");
      }
      return toolDispatcher("computer.play_youtube", {
        query: targetQuery,
        action: "play",
        comment: commentText,
        approved: action.approvalState === "approved",
        mediaSubtype: action.params.mediaSubtype || "video",
      });
    }

    case "commerce.add_to_cart":
    case "commerce.purchase":
    case "browser.autonomous_act": {
      const goal = String(action.params.instruction || action.expectedOutcome);
      return toolDispatcher("browser.autonomous_act", {
        goal,
        ...(plan.sharedContext.url ? { startUrl: plan.sharedContext.url } : {}),
      });
    }

    case "workflow.cancel": {
      return { success: true, cancelled: true };
    }

    default:
      throw new Error(`UNKNOWN_ACTION_OR_TOOL: No registered tool handler for action type "${action.type}".`);
  }
}

async function withActionTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  actionId: string,
  externalSignal?: AbortSignal
): Promise<{ value: T; timedOut: false } | { timedOut: true; cancelled: boolean; error: string }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let cancelled = Boolean(externalSignal?.aborted);

  const onExternalAbort = (): void => {
    cancelled = true;
    controller.abort(new Error(`ACTION_CANCELLED: Action ${actionId} was cancelled`));
  };
  if (externalSignal) {
    if (externalSignal.aborted) {
      onExternalAbort();
      return { timedOut: true, cancelled: true, error: `ACTION_CANCELLED: Action ${actionId} was cancelled` };
    }
    externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    const execPromise = run(controller.signal).then((value) => ({ value, timedOut: false as const }));
    if (!timeoutMs || timeoutMs <= 0) {
      return await execPromise;
    }

    const timeoutPromise = new Promise<{ timedOut: true; cancelled: boolean; error: string }>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        const errMsg = `ACTION_TIMEOUT: Action ${actionId} timed out after ${timeoutMs}ms`;
        controller.abort(new Error(errMsg));
        resolve({ timedOut: true, cancelled: false, error: errMsg });
      }, timeoutMs);
    });

    return await Promise.race([execPromise, timeoutPromise]);
  } catch (err) {
    if (cancelled) {
      return { timedOut: true, cancelled: true, error: `ACTION_CANCELLED: Action ${actionId} was cancelled` };
    }
    if (timedOut) {
      return { timedOut: true, cancelled: false, error: `ACTION_TIMEOUT: Action ${actionId} timed out after ${timeoutMs}ms` };
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
  }
}

async function defaultSummarizer(instruction: string, sourceText: string): Promise<string> {
  if (!sourceText.trim()) {
    throw new Error("Cannot summarize empty source content.");
  }
  const lines = sourceText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 5);
  return `Summary (${instruction}):\n${lines.join("\n")}`;
}

/**
 * Executes a UniversalExecutionPlan in dependency order with safe parallel batching,
 * approval gating, idempotency protection, verification, and failure isolation.
 */
export async function executeUniversalPlan(
  plan: UniversalExecutionPlan,
  options: UniversalExecutorOptions = {}
): Promise<UniversalExecutionResult> {
  const startedAt = Date.now();
  const channel = options.channel || "tui";
  const toolDispatcher: ToolDispatcherFn =
    options.toolDispatcher ?? ((id, params): Promise<unknown> => dispatchTool(id, params));
  const mcpCaller: McpCallerFn =
    options.mcpCaller ?? ((s, t, p): Promise<McpExecutionResult> => mcpCoordinator.callTool(s, t, p));
  const summarizer = options.summarizer ?? defaultSummarizer;
  const verifier = options.verifier ?? defaultActionVerifier;
  const maxConcurrency = Math.max(1, options.maxConcurrency ?? 3);

  const validation = validateExecutionPlan(plan);
  if (!validation.valid) {
    plan.overallStatus = "failed";
    return {
      plan,
      success: false,
      verified: false,
      awaitingApproval: false,
      summary: `Invalid execution plan: ${validation.errors.join("; ")}`,
      durationMs: Date.now() - startedAt,
    };
  }

  const completedIds = new Set<string>(
    plan.actions.filter((a) => a.status === "completed").map((a) => a.id)
  );
  const failedOrBlockedIds = new Set<string>(
    plan.actions
      .filter(
        (a) =>
          a.status === "failed" ||
          a.status === "timed_out" ||
          a.status === "verification_failed" ||
          a.status === "cancelled" ||
          a.status === "skipped"
      )
      .map((a) => a.id)
  );

  // Execute dependency waves until no pending runnable actions remain
  let progress = true;
  while (progress) {
    progress = false;

    // 1. Mark actions whose dependencies failed/skipped/cancelled/timed_out as skipped
    for (const action of plan.actions) {
      if (action.status !== "pending") continue;
      if (options.cancellationSignal?.aborted || options.cancelledActionIds?.has(action.id)) {
        action.status = "cancelled";
        action.error = "Action cancelled before execution.";
        failedOrBlockedIds.add(action.id);
        progress = true;
        continue;
      }
      if (action.dependsOn.some((depId) => failedOrBlockedIds.has(depId))) {
        action.status = "skipped";
        action.error = "Skipped because an upstream dependency did not complete.";
        failedOrBlockedIds.add(action.id);
        progress = true;
      }
    }

    // 2. Collect ready actions (all dependencies completed)
    const ready = plan.actions.filter(
      (a) => a.status === "pending" && a.dependsOn.every((depId) => completedIds.has(depId))
    );
    if (ready.length === 0) break;

    // 3. Enforce approval gate before running external side effects
    const runnable: PlannedAction[] = [];
    for (const action of ready) {
      if (action.requiresApproval && action.approvalState !== "approved" && !options.allowApprovalBypass) {
        const existingPending = getPendingActionApproval(channel, options.sessionId);
        if (existingPending && existingPending.actionType === action.type) {
          const check = revalidatePendingApproval(
            existingPending,
            plan.sharedContext.url,
            action.params
          );
          if (check.valid) {
            action.approvalState = "approved";
            clearPendingActionApproval(channel, options.sessionId);
            runnable.push(action);
            continue;
          }
        }

        action.status = "awaiting_approval";
        action.approvalState = "pending";
        setPendingActionApproval(
          channel,
          {
            intent: "ACTION_APPROVAL",
            actionType: action.type,
            platform: action.platform || "generic",
            target: plan.sharedContext.url || plan.sharedContext.title || action.target || action.type,
            targetUrl: plan.sharedContext.url,
            targetTitle: plan.sharedContext.title,
            params: { ...action.params, planId: plan.planId, actionId: action.id },
            approvalState: "pending",
            expiresAt: Date.now() + 5 * 60 * 1000,
            createdAt: Date.now(),
          },
          options.sessionId
        );
        progress = true;
        continue;
      }
      runnable.push(action);
    }

    if (runnable.length === 0) continue;

    // 4. Execute runnable batch (parallel if all are idempotent, otherwise sequential)
    const canParallelize = runnable.length > 1 && runnable.every((a) => a.idempotent);
    const batch = canParallelize ? runnable.slice(0, maxConcurrency) : [runnable[0]!];

    await Promise.all(
      batch.map(async (action) => {
        progress = true;
        action.status = "running";
        const maxAttempts = action.idempotent ? Math.max(1, action.retryPolicy.maxAttempts) : 1;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            const raceRes = await withActionTimeout(
              (signal) =>
                dispatchSingleAction(action, plan, {
                  toolDispatcher,
                  mcpCaller,
                  summarizer,
                  signal,
                }),
              action.timeoutMs,
              action.id,
              options.cancellationSignal
            );

            if (raceRes.timedOut) {
              action.error = raceRes.error;
              action.status = raceRes.cancelled ? "cancelled" : "timed_out";
              log.warn(raceRes.cancelled ? "[UNIVERSAL_EXECUTOR_ACTION_CANCELLED]" : "[UNIVERSAL_EXECUTOR_ACTION_TIMED_OUT]", {
                actionId: action.id,
                type: action.type,
                attempt,
                maxAttempts,
                error: raceRes.error,
              });
              if (raceRes.cancelled || !action.idempotent || attempt === maxAttempts) {
                failedOrBlockedIds.add(action.id);
                return;
              }
              continue;
            }

            const output = raceRes.value;
            action.result = output;

            const evidence = await verifier(action, output, plan.sharedContext);
            action.evidence = evidence;

            if (evidence.verified) {
              action.status = "completed";
              completedIds.add(action.id);
              return;
            } else {
              action.status = "verification_failed";
              action.error = evidence.reason;
              if (!action.idempotent || attempt === maxAttempts) {
                failedOrBlockedIds.add(action.id);
                return;
              }
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            action.error = msg;
            log.warn("[UNIVERSAL_EXECUTOR_ACTION_FAILED]", {
              actionId: action.id,
              type: action.type,
              attempt,
              maxAttempts,
              error: msg,
            });
            if (!action.idempotent || attempt === maxAttempts) {
              action.status = "failed";
              failedOrBlockedIds.add(action.id);
              return;
            }
          }
        }
      })
    );
  }

  plan.overallStatus = computePlanOverallStatus(plan.actions);
  recordPlanExecution(channel, plan, options.sessionId);

  const awaitingApproval = plan.actions.some((a) => a.status === "awaiting_approval");
  const allCompleted = plan.overallStatus === "completed";
  const allVerified = allCompleted && plan.actions.every((a) => a.evidence?.verified === true);

  return {
    plan,
    success: allCompleted,
    verified: allVerified,
    awaitingApproval,
    summary: formatPlanExecutionSummary(plan),
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Resumes a paused UniversalExecutionPlan stored in taskContextStore after user
 * approval, rejection, cancellation, or parameter modification — without repeating
 * any previously completed actions.
 */
export async function resumePausedPlan(
  channel: string,
  decision: "approved" | "rejected" | "cancelled" | "modified",
  options: UniversalExecutorOptions & { modifiedParams?: Record<string, unknown> } = {}
): Promise<UniversalExecutionResult | null> {
  const ctx = getTaskContext(channel, options.sessionId);
  const plan = ctx?.lastPlan;
  if (!plan) return null;

  const pausedAction = plan.actions.find((a) => a.status === "awaiting_approval");
  if (!pausedAction) return null;

  if (decision === "rejected" || decision === "cancelled") {
    pausedAction.approvalState = decision;
    pausedAction.status = "cancelled";
    pausedAction.error = `Action ${decision} by user.`;
    clearPendingActionApproval(channel, options.sessionId);
    return executeUniversalPlan(plan, { ...options, channel });
  }

  if (decision === "modified" && options.modifiedParams) {
    pausedAction.params = { ...pausedAction.params, ...options.modifiedParams };
    pausedAction.approvalState = "modified";
    // Require explicit re-approval after material modification
    setPendingActionApproval(
      channel,
      {
        intent: "ACTION_APPROVAL",
        actionType: pausedAction.type,
        platform: pausedAction.platform || "generic",
        target: plan.sharedContext.url || plan.sharedContext.title || pausedAction.target || pausedAction.type,
        targetUrl: plan.sharedContext.url,
        targetTitle: plan.sharedContext.title,
        params: { ...pausedAction.params, planId: plan.planId, actionId: pausedAction.id },
        approvalState: "modified",
        expiresAt: Date.now() + 5 * 60 * 1000,
        createdAt: Date.now(),
      },
      options.sessionId
    );
    recordPlanExecution(channel, plan, options.sessionId);
    return {
      plan,
      success: false,
      verified: false,
      awaitingApproval: true,
      summary: formatPlanExecutionSummary(plan),
      durationMs: 0,
    };
  }

  // decision === "approved"
  pausedAction.approvalState = "approved";
  pausedAction.status = "pending";
  clearPendingActionApproval(channel, options.sessionId);
  return executeUniversalPlan(plan, { ...options, channel });
}

