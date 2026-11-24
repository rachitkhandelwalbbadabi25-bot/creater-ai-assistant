// ════════════════════════════════════════════════════════════════════════════════
// src/tools/laptop/desktopControl.ts — Native Desktop Input & Window Controls (Phase 8)
// Provides OS-level mouse clicks, moves, keystrokes, and window management.
// ════════════════════════════════════════════════════════════════════════════════

import { execFile, spawn, type ChildProcessWithoutNullStreams } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { createLogger } from "@utils/logger.js";
import { validateFileOp } from "../safety.js";
import { clipboardOp } from "./system.js";

const execFileAsync = promisify(execFile);
const log = createLogger("tools/desktopControl");

function getScriptPath(): string {
  const candidates = [
    path.resolve(__dirname, "desktopControl.ps1"),
    path.resolve(process.cwd(), "src/tools/laptop/desktopControl.ps1"),
    path.resolve(process.cwd(), "../../src/tools/laptop/desktopControl.ps1"),
    path.resolve(process.cwd(), "../src/tools/laptop/desktopControl.ps1"),
    path.resolve(__dirname, "../../../../src/tools/laptop/desktopControl.ps1"),
    "D:\\creater-ai-assistant\\src\\tools\\laptop\\desktopControl.ps1",
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore inaccessible candidate path */
    }
  }
  return candidates[0];
}

export interface ActiveWindowInfo {
  success: boolean;
  hwnd?: number;
  title?: string;
  process?: string;
  pid?: number;
  openApps?: string[];
  bounds?: { x: number; y: number; width: number; height: number };
  error?: string;
}

export interface DesktopActionResult {
  success: boolean;
  action: string;
  method?: string;
  x?: number;
  y?: number;
  button?: string;
  textLength?: number;
  typedChars?: number;
  key?: string;
  message?: string;
  error?: string;
}

export interface DesktopControlResult {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface WorkerRpcError {
  code: number;
  message: string;
  data?: string;
}

export interface WorkerRpcEnvelope<T = DesktopControlResult> {
  id: string | null;
  result?: T;
  error?: WorkerRpcError;
}

export interface DesktopWorkerStats {
  isRunning: boolean;
  pid: number | null;
  restartCount: number;
  requestsHandled: number;
}

interface PendingWorkerRequest {
  id: string;
  action: string;
  resolve: (envelope: WorkerRpcEnvelope<unknown>) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Persistent PowerShell CUA Worker (Phase 8.1 TASK 3).
 * Keeps a single reusable PowerShell process with DesktopNative and UIA loaded once,
 * communicating over stdin/stdout with Base64-framed JSON-RPC (__CREATER_RPC__<b64>__END__)
 * so stdout diagnostic logs never corrupt JSON responses.
 */
class DesktopControlWorker {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = "";
  private requestSeq = 0;
  private restartCount = 0;
  private requestsHandled = 0;
  private hadRunningProcess = false;
  private intentionalStop = false;
  private pendingById = new Map<string, PendingWorkerRequest>();
  private pendingRawQueue: PendingWorkerRequest[] = [];

  public getStats(): DesktopWorkerStats {
    return {
      isRunning: Boolean(this.proc && !this.proc.killed && this.proc.exitCode === null),
      pid: this.proc && !this.proc.killed && this.proc.exitCode === null ? (this.proc.pid ?? null) : null,
      restartCount: this.restartCount,
      requestsHandled: this.requestsHandled,
    };
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.proc && !this.proc.killed && this.proc.exitCode === null) {
      return this.proc;
    }

    if (this.hadRunningProcess && !this.intentionalStop) {
      this.restartCount++;
    }

    const scriptPath = getScriptPath();
    this.stdoutBuffer = "";
    this.intentionalStop = false;

    const child = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-Action", "worker"],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    this.proc = child;
    this.hadRunningProcess = true;

    child.stdout.on("data", (chunk: Buffer) => {
      this.onStdoutData(chunk.toString("utf8"));
    });

    child.stderr.on("data", () => {
      // Diagnostic stderr output is ignored so it never corrupts JSON-RPC framing
    });

    child.on("exit", (code, signal) => {
      if (this.proc !== child) {
        return;
      }
      this.proc = null;
      const exitErr = new Error(
        `Desktop PowerShell worker exited unexpectedly (code=${String(code)}, signal=${String(signal)})`
      );
      this.rejectAllPending(exitErr);
    });

    child.on("error", (err) => {
      if (this.proc !== child) {
        return;
      }
      this.proc = null;
      this.rejectAllPending(err instanceof Error ? err : new Error(String(err)));
    });

    return child;
  }

  private rejectAllPending(err: Error): void {
    for (const req of this.pendingById.values()) {
      clearTimeout(req.timer);
      req.reject(err);
    }
    this.pendingById.clear();

    while (this.pendingRawQueue.length > 0) {
      const rawReq = this.pendingRawQueue.shift();
      if (rawReq) {
        clearTimeout(rawReq.timer);
        rawReq.reject(err);
      }
    }
  }

  private onStdoutData(text: string): void {
    this.stdoutBuffer += text;

    let match = this.stdoutBuffer.match(/__CREATER_RPC__([\s\S]*?)__END__/);
    while (match) {
      const fullMatchEnd = (match.index ?? 0) + match[0].length;
      const b64Payload = (match[1] || "").replace(/\s+/g, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(fullMatchEnd);

      let envelope: WorkerRpcEnvelope<unknown> | null = null;
      try {
        const decoded = Buffer.from(b64Payload, "base64").toString("utf8");
        envelope = JSON.parse(decoded) as WorkerRpcEnvelope<unknown>;
      } catch (parseErr) {
        log.warn("Failed to decode worker RPC frame", {
          error: parseErr instanceof Error ? parseErr.message : String(parseErr),
        });
      }

      if (envelope) {
        this.requestsHandled++;

        if (envelope.id !== null && envelope.id !== undefined && this.pendingById.has(String(envelope.id))) {
          const idKey = String(envelope.id);
          const pending = this.pendingById.get(idKey)!;
          this.pendingById.delete(idKey);
          clearTimeout(pending.timer);
          pending.resolve(envelope);
        } else if (this.pendingRawQueue.length > 0) {
          const rawPending = this.pendingRawQueue.shift()!;
          clearTimeout(rawPending.timer);
          rawPending.resolve(envelope);
        } else if (this.pendingById.size === 1) {
          const [onlyKey, onlyPending] = this.pendingById.entries().next().value as [string, PendingWorkerRequest];
          this.pendingById.delete(onlyKey);
          clearTimeout(onlyPending.timer);
          onlyPending.resolve(envelope);
        }
      }

      match = this.stdoutBuffer.match(/__CREATER_RPC__([\s\S]*?)__END__/);
    }
  }

  public async sendRequest<T = DesktopControlResult>(
    action: string,
    params: Record<string, unknown> = {},
    timeoutMs = 15000
  ): Promise<T> {
    if (process.platform !== "win32") {
      return { success: true, simulated: true, action } as unknown as T;
    }

    const child = this.ensureProcess();
    const id = `rpc_${++this.requestSeq}_${Date.now()}`;

    const envelope = await new Promise<WorkerRpcEnvelope<T>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingById.delete(id);
        // Kill the timed-out worker process so the next request cleanly restarts it
        this.forceKillProcess();
        reject(new Error(`Desktop worker request timed out after ${timeoutMs}ms (action=${action})`));
      }, timeoutMs);

      this.pendingById.set(id, {
        id,
        action,
        resolve: resolve as (env: WorkerRpcEnvelope<unknown>) => void,
        reject,
        timer,
      });

      try {
        const line = JSON.stringify({ id, action, params }) + "\n";
        child.stdin.write(line, "utf8");
      } catch (writeErr) {
        clearTimeout(timer);
        this.pendingById.delete(id);
        reject(writeErr instanceof Error ? writeErr : new Error(String(writeErr)));
      }
    });

    if (envelope.error) {
      throw new Error(`Worker RPC error (${envelope.error.code}): ${envelope.error.message}`);
    }

    return (envelope.result ?? ({ success: false, error: "Empty worker response" } as unknown as T)) as T;
  }

  /**
   * Sends a raw unformatted line to the worker's stdin (used to test malformed JSON-RPC resilience).
   */
  public async sendRawLine(rawLine: string, timeoutMs = 10000): Promise<WorkerRpcEnvelope<unknown>> {
    const child = this.ensureProcess();
    const id = `raw_${++this.requestSeq}_${Date.now()}`;

    return new Promise<WorkerRpcEnvelope<unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.pendingRawQueue.findIndex((item) => item.id === id);
        if (idx >= 0) this.pendingRawQueue.splice(idx, 1);
        this.forceKillProcess();
        reject(new Error(`Desktop worker raw request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRawQueue.push({
        id,
        action: "raw",
        resolve,
        reject,
        timer,
      });

      try {
        const cleanLine = rawLine.endsWith("\n") ? rawLine : `${rawLine}\n`;
        child.stdin.write(cleanLine, "utf8");
      } catch (writeErr) {
        clearTimeout(timer);
        const idx = this.pendingRawQueue.findIndex((item) => item.id === id);
        if (idx >= 0) this.pendingRawQueue.splice(idx, 1);
        reject(writeErr instanceof Error ? writeErr : new Error(String(writeErr)));
      }
    });
  }

  public forceKillProcess(): void {
    const current = this.proc;
    this.proc = null;
    if (current && !current.killed && current.exitCode === null) {
      try {
        current.kill("SIGKILL");
      } catch {
        try {
          current.kill();
        } catch {
          /* ignore kill errors */
        }
      }
    }
  }

  public async shutdown(): Promise<void> {
    this.intentionalStop = true;
    this.hadRunningProcess = false;
    const current = this.proc;
    if (!current || current.killed || current.exitCode !== null) {
      this.proc = null;
      return;
    }
    try {
      await this.sendRequest("shutdown", {}, 2500);
    } catch {
      /* ignore shutdown errors */
    } finally {
      this.forceKillProcess();
      this.hadRunningProcess = false;
    }
  }
}

const desktopWorker = new DesktopControlWorker();

function parseCliArgsToWorkerPayload(args: string[]): { action: string; params: Record<string, unknown> } {
  let action = "getactivewindow";
  const params: Record<string, unknown> = {};

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (!token.startsWith("-")) continue;
    const key = token.replace(/^-+/, "");
    const nextVal = i + 1 < args.length && !args[i + 1].startsWith("-") ? args[++i] : "true";
    if (key.toLowerCase() === "action") {
      action = String(nextVal).toLowerCase();
    } else {
      params[key] = nextVal;
    }
  }

  return { action, params };
}

/** Sends a structured JSON-RPC request directly to the persistent PowerShell desktop worker */
export async function sendWorkerRpcRequest<T = DesktopControlResult>(
  action: string,
  params: Record<string, unknown> = {},
  timeoutMs = 15000
): Promise<T> {
  return desktopWorker.sendRequest<T>(action, params, timeoutMs);
}

/** Sends a raw line to the persistent PowerShell desktop worker (for malformed JSON-RPC testing) */
export async function sendRawWorkerLine(
  rawLine: string,
  timeoutMs = 10000
): Promise<WorkerRpcEnvelope<unknown>> {
  return desktopWorker.sendRawLine(rawLine, timeoutMs);
}

/** Returns health and lifecycle telemetry for the persistent PowerShell desktop worker */
export function getDesktopWorkerStats(): DesktopWorkerStats {
  return desktopWorker.getStats();
}

/** Forces termination of the active PowerShell worker process (to test crash recovery) */
export function killDesktopWorkerForTest(): void {
  desktopWorker.forceKillProcess();
}

/** Cleanly shuts down the persistent PowerShell desktop worker */
export async function shutdownDesktopWorker(): Promise<void> {
  await desktopWorker.shutdown();
}

/**
 * Cold one-shot PowerShell invocation (spawns a fresh powershell.exe process).
 * Exposed for cold-vs-warm latency benchmarking and fallback recovery.
 */
export async function runDesktopControlCold<T = DesktopControlResult>(args: string[]): Promise<T> {
  if (process.platform !== "win32") {
    log.info(`DesktopControl called on non-windows platform: ${args.join(" ")}`);
    return { success: true, simulated: true, action: args[1] || "unknown" } as unknown as T;
  }

  const scriptPath = getScriptPath();
  const actionName = args[0] === "-Action" ? args[1] : undefined;
  const timeoutMs =
    actionName === "writeapp" ? 25000 : actionName === "youtubecomment" ? 30000 : actionName === "inspectbrowser" ? 15000 : 10000;
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args],
    { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true }
  );
  const trimmed = stdout.trim();
  const b64Match = trimmed.match(/__CREATER_B64__([\s\S]*?)__END__/);
  if (b64Match && b64Match[1]) {
    const cleanB64 = b64Match[1].replace(/\s+/g, "");
    const decodedJson = Buffer.from(cleanB64, "base64").toString("utf8");
    return JSON.parse(decodedJson);
  }
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  return JSON.parse(trimmed);
}

async function runDesktopControl<T = DesktopControlResult>(args: string[]): Promise<T> {
  if (process.platform !== "win32") {
    // Linux/macOS mock fallback for cross-platform CI / dev environments
    log.info(`DesktopControl called on non-windows platform: ${args.join(" ")}`);
    return { success: true, simulated: true, action: args[1] || "unknown" } as unknown as T;
  }

  try {
    const actionName = args[0] === "-Action" ? args[1] : undefined;
    const timeoutMs =
      actionName === "writeapp" ? 25000 : actionName === "youtubecomment" ? 30000 : actionName === "inspectbrowser" ? 15000 : 10000;

    try {
      const { action, params } = parseCliArgsToWorkerPayload(args);
      return await desktopWorker.sendRequest<T>(action, params, timeoutMs);
    } catch (workerErr) {
      log.warn("Persistent desktop worker failed, falling back to cold PowerShell invocation", {
        error: workerErr instanceof Error ? workerErr.message : String(workerErr),
      });
      return await runDesktopControlCold<T>(args);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Inline fallback for typing / keys if file invocation fails
    if (args[0] === "-Action" && args[1] === "type" && args[2] === "-Text") {
      const textToType = args[3] || "";
      try {
        const escaped = textToType.replace(/'/g, "''");
        await execFileAsync(
          "powershell.exe",
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escaped}')`,
          ],
          { windowsHide: true, timeout: 5000 }
        );
        return { success: true, action: "type", textLength: textToType.length } as unknown as T;
      } catch (fbErr: unknown) {
        const fbMessage = fbErr instanceof Error ? fbErr.message : String(fbErr);
        log.error("SendKeys fallback failed", { error: fbMessage });
      }
    }
    log.error("DesktopControl execution failed", { args, error: errorMessage });
    return { success: false, error: errorMessage } as unknown as T;
  }
}

/** Moves the mouse cursor to absolute desktop coordinates (x, y) */
export async function moveDesktopMouse(x: number, y: number): Promise<DesktopActionResult> {
  return runDesktopControl(["-Action", "move", "-X", String(Math.round(x)), "-Y", String(Math.round(y))]);
}

/** Clicks at absolute desktop coordinates (x, y) */
export async function clickDesktop(
  x: number,
  y: number,
  button: "left" | "right" | "middle" | "double" = "left"
): Promise<DesktopActionResult> {
  return runDesktopControl([
    "-Action",
    "click",
    "-X",
    String(Math.round(x)),
    "-Y",
    String(Math.round(y)),
    "-Button",
    button,
  ]);
}

/** Sends keystroke text to the active desktop window */
export async function typeDesktopText(text: string): Promise<DesktopActionResult> {
  return runDesktopControl(["-Action", "type", "-Text", text]);
}

/** Sends a special key (e.g. {ENTER}, {ESC}, {TAB}, ^c, ^v) */
export async function pressDesktopKey(key: string): Promise<DesktopActionResult> {
  return runDesktopControl(["-Action", "key", "-Key", key]);
}

/** Retrieves the currently focused foreground window */
export async function getActiveDesktopWindow(): Promise<ActiveWindowInfo> {
  return runDesktopControl(["-Action", "getactivewindow"]);
}

export interface DesktopSurfaceElement {
  id?: string;
  source: "uia" | "ocr";
  role: string;
  name: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isFocused?: boolean;
}

export interface DesktopBrowserSurface {
  success: boolean;
  title?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  uiaLatencyMs?: number;
  ocrLatencyMs?: number;
  totalLatencyMs?: number;
  elements?: DesktopSurfaceElement[];
  error?: string;
}

/** Focuses a window by title substring or PID, optionally preferring a tab matching siteHint */
export async function focusDesktopWindow(
  target: string | number,
  siteHint?: string
): Promise<{ success: boolean; found: boolean; title?: string; pid?: number; message?: string }> {
  const args = ["-Action", "focuswindow", "-TargetWindow", String(target)];
  if (siteHint) {
    args.push("-SiteHint", siteHint);
  }
  return runDesktopControl(args);
}

/**
 * Inspects a live desktop browser window's web content area via Windows UI Automation + WinRT OCR,
 * returning clickable UI controls and OCR text lines with exact screen coordinates.
 */
export async function inspectDesktopBrowserSurface(
  targetWindow = "chrome",
  siteHint?: string
): Promise<DesktopBrowserSurface> {
  const args = ["-Action", "inspectbrowser", "-TargetWindow", targetWindow];
  if (siteHint) {
    args.push("-SiteHint", siteHint);
  }
  const res = (await runDesktopControl(args)) as {
    success?: boolean;
    title?: string;
    bounds?: { x: number; y: number; width: number; height: number };
    uiaLatencyMs?: number;
    ocrLatencyMs?: number;
    totalLatencyMs?: number;
    elements?: DesktopSurfaceElement[] | DesktopSurfaceElement;
    error?: string;
  };
  const rawElements: DesktopSurfaceElement[] = Array.isArray(res?.elements)
    ? res.elements
    : res?.elements
      ? [res.elements]
      : [];
  return {
    success: Boolean(res?.success),
    title: res?.title,
    bounds: res?.bounds,
    uiaLatencyMs: res?.uiaLatencyMs,
    ocrLatencyMs: res?.ocrLatencyMs,
    totalLatencyMs: res?.totalLatencyMs,
    error: res?.error,
    elements: rawElements.map((el, idx) => ({
      ...el,
      id: `@d${idx + 1}`,
    })),
  };
}

/**
 * Pastes text reliably into the currently focused desktop input using clipboard + Ctrl+V
 * (avoiding SendKeys special-character escaping bugs), optionally pressing Enter to submit.
 */
export async function pasteDesktopText(text: string, submit = false): Promise<DesktopActionResult> {
  await clipboardOp("write", text);
  await new Promise((r) => setTimeout(r, 80));
  const pasteRes = await pressDesktopKey("^v");
  if (submit && pasteRes.success) {
    await new Promise((r) => setTimeout(r, 120));
    await pressDesktopKey("{ENTER}");
  }
  return {
    ...pasteRes,
    action: "paste",
    textLength: text.length,
  };
}

/**
 * Clicks target desktop coordinates, selects all, pastes text cleanly, and optionally submits
 * with Enter in a single native PowerShell invocation.
 */
export async function clickAndPasteDesktop(
  x: number,
  y: number,
  text: string,
  submit = false
): Promise<DesktopActionResult> {
  const args = [
    "-Action",
    "clickandpaste",
    "-X",
    String(Math.round(x)),
    "-Y",
    String(Math.round(y)),
    "-Text",
    text,
    ...(submit ? ["-Key", "{ENTER}"] : []),
  ];
  const res = (await runDesktopControl(args)) as DesktopActionResult;
  if (res?.success || /editable/i.test(res?.error || "")) {
    return res;
  }
  // Safe fallback if native clickandpaste fails for transport reasons (never when target is non-editable)
  await clickDesktop(x, y, "left");
  await new Promise((r) => setTimeout(r, 180));
  await pressDesktopKey("^a").catch(() => {});
  return pasteDesktopText(text, submit);
}

/**
 * Focuses and verifies the target desktop application window, locates its primary editor surface via UIA,
 * and types multiline/Unicode text directly via Win32 SendInput (no clipboard copy-paste).
 */
export async function writeToDesktopApp(
  targetApp: string,
  text: string
): Promise<DesktopActionResult & { found?: boolean; title?: string }> {
  const b64 = Buffer.from(text, "utf8").toString("base64");
  return runDesktopControl([
    "-Action",
    "writeapp",
    "-TargetWindow",
    targetApp,
    "-TextBase64",
    b64,
  ]);
}

export interface YouTubeCommentOptions {
  /**
   * Explicit approval gate for YouTube comment publication (Phase 8.1 TASK 1).
   * - undefined: Composes the comment and returns AWAITING_APPROVAL without publishing.
   * - true: Composes, publishes, re-observes the page, and verifies thread presence.
   * - false: Rejects and aborts publication immediately.
   */
  approved?: boolean;
}

export interface YouTubeCommentResult extends DesktopActionResult {
  status?: "SUCCESS" | "PARTIAL_SUCCESS" | "FAILED" | "AWAITING_APPROVAL";
  requiresApproval?: boolean;
  approved?: boolean;
  found?: boolean;
  title?: string;
  submitMethod?: string;
  composed?: boolean;
  composedVerified?: boolean;
  published?: boolean;
  verified?: boolean;
  readBackLength?: number;
}

/**
 * Deterministic verifier for the YouTube comment approval & post-publish verification lifecycle (Phase 8.1 TASK 1).
 * Ensures no comment can transition to published/SUCCESS without explicit approval and thread verification.
 */
export function evaluateYouTubeCommentLifecycle(params: {
  commentText: string;
  approved?: boolean;
  composedReadBack?: string;
  threadObservedTexts?: string[];
}): YouTubeCommentResult {
  const cleanComment = (params.commentText || "").trim();
  if (!cleanComment) {
    return {
      success: false,
      status: "FAILED",
      action: "youtubecomment",
      composed: false,
      published: false,
      verified: false,
      error: "Comment text cannot be empty",
    };
  }

  if (params.approved === false) {
    return {
      success: false,
      status: "FAILED",
      action: "youtubecomment",
      approved: false,
      requiresApproval: true,
      composed: false,
      published: false,
      verified: false,
      error: "User rejected YouTube comment publication",
    };
  }

  const probe = cleanComment.slice(0, Math.min(24, cleanComment.length));
  const composedReadBack = params.composedReadBack ?? cleanComment;
  const composedVerified = composedReadBack.includes(probe);

  if (params.approved !== true) {
    return {
      success: false,
      status: "AWAITING_APPROVAL",
      action: "youtubecomment",
      requiresApproval: true,
      approved: false,
      composed: true,
      composedVerified,
      published: false,
      verified: false,
      textLength: cleanComment.length,
      message: "YouTube comment composed and verified in editor; awaiting explicit user approval before publishing.",
    };
  }

  const observed = params.threadObservedTexts || [];
  const publishedVerified = observed.some((item) => item && item.includes(probe));

  return {
    success: publishedVerified,
    status: publishedVerified ? "SUCCESS" : "PARTIAL_SUCCESS",
    action: "youtubecomment",
    requiresApproval: false,
    approved: true,
    composed: true,
    composedVerified,
    published: true,
    verified: publishedVerified,
    textLength: cleanComment.length,
    error: publishedVerified
      ? undefined
      : "Comment submission triggered, but post-publish thread verification did not detect the published comment.",
  };
}

/**
 * Scrolls the active YouTube watch tab in desktop Chrome down to the comments section,
 * focuses the "Add a comment..." input box via UIA / WinRT OCR, composes the comment,
 * enforces explicit user approval (returning AWAITING_APPROVAL unless options.approved === true),
 * and verifies that the published comment appears in the comment thread after publishing.
 */
export async function commentOnYouTubeDesktop(
  commentText: string,
  siteHint = "YouTube",
  targetBrowser = "chrome",
  options?: YouTubeCommentOptions
): Promise<YouTubeCommentResult> {
  if (options?.approved === false) {
    return evaluateYouTubeCommentLifecycle({ commentText, approved: false });
  }

  const b64 = Buffer.from(commentText, "utf8").toString("base64");
  const approvedFlag = options?.approved === true ? "true" : "pending";
  const res = await runDesktopControl<YouTubeCommentResult>([
    "-Action",
    "youtubecomment",
    "-TargetWindow",
    targetBrowser,
    "-SiteHint",
    siteHint,
    "-TextBase64",
    b64,
    "-Approved",
    approvedFlag,
  ]);

  // Never allow SUCCESS if post-publish verification did not pass or approval was not granted
  if (options?.approved !== true && res.status === "SUCCESS") {
    return {
      ...res,
      success: false,
      status: "AWAITING_APPROVAL",
      requiresApproval: true,
      published: false,
      verified: false,
    };
  }
  if (res.status === "SUCCESS" && res.verified !== true) {
    return {
      ...res,
      success: false,
      status: "PARTIAL_SUCCESS",
      verified: false,
    };
  }
  return res;
}

export interface SaveDesktopAppOptions {
  targetApp?: string;
  filePath: string;
  expectedContent?: string;
  overwrite?: boolean;
}

export interface SaveDesktopAppResult extends DesktopActionResult {
  status: "SUCCESS" | "PARTIAL_SUCCESS" | "FAILED" | "AWAITING_APPROVAL";
  filePath?: string;
  found?: boolean;
  title?: string;
  dialogHandled?: boolean;
  fileExists?: boolean;
  verified?: boolean;
  savedLength?: number;
  requiresApproval?: boolean;
  existingFileProtected?: boolean;
}

/**
 * Independently verifies a saved file on disk by checking existence, reading back its contents,
 * and comparing against the expected document text (Phase 8.1 TASK 2).
 */
export function verifySavedDesktopFile(filePath: string, expectedContent?: string): SaveDesktopAppResult {
  const cleanPath = (filePath || "").trim();
  if (!cleanPath) {
    return {
      success: false,
      status: "FAILED",
      action: "saveapp",
      fileExists: false,
      verified: false,
      error: "Target FilePath is required for verification",
    };
  }

  const resolvedPath = path.resolve(cleanPath);
  if (!fs.existsSync(resolvedPath)) {
    return {
      success: false,
      status: "FAILED",
      action: "saveapp",
      filePath: resolvedPath,
      fileExists: false,
      verified: false,
      error: `Save verification failed: file '${resolvedPath}' does not exist on disk`,
    };
  }

  let savedContent = "";
  try {
    savedContent = fs.readFileSync(resolvedPath, "utf8");
  } catch (readErr) {
    return {
      success: false,
      status: "FAILED",
      action: "saveapp",
      filePath: resolvedPath,
      fileExists: true,
      verified: false,
      error: `Failed to read saved file '${resolvedPath}': ${readErr instanceof Error ? readErr.message : String(readErr)}`,
    };
  }

  if (expectedContent !== undefined && expectedContent.length > 0) {
    const normSaved = savedContent.replace(/\r\n/g, "\n").trim();
    const normExpected = expectedContent.replace(/\r\n/g, "\n").trim();
    const contentMatched = normSaved === normExpected || normSaved.includes(normExpected);
    if (!contentMatched) {
      return {
        success: false,
        status: "FAILED",
        action: "saveapp",
        filePath: resolvedPath,
        fileExists: true,
        verified: false,
        savedLength: savedContent.length,
        error: "Save verification failed: file exists on disk, but saved content does not match expected content",
      };
    }
  }

  return {
    success: true,
    status: "SUCCESS",
    action: "saveapp",
    filePath: resolvedPath,
    fileExists: true,
    verified: true,
    savedLength: savedContent.length,
  };
}

/**
 * Dedicated native desktop Save workflow (Phase 8.1 TASK 2).
 * - Protects existing files unless overwrite === true (returns AWAITING_APPROVAL).
 * - Validates parent directory existence and file safety policies.
 * - Executes Ctrl+S, interacts with the native Save As dialog via UIA, and verifies saved disk contents.
 */
export async function saveDesktopAppDocument(options: SaveDesktopAppOptions): Promise<SaveDesktopAppResult> {
  const rawPath = (options.filePath || "").trim();
  if (!rawPath) {
    return {
      success: false,
      status: "FAILED",
      action: "saveapp",
      error: "Target FilePath is required for saveapp",
    };
  }

  const resolvedPath = path.resolve(rawPath);
  const safety = validateFileOp("write", resolvedPath);
  if (!safety.allowed) {
    return {
      success: false,
      status: "FAILED",
      action: "saveapp",
      filePath: resolvedPath,
      error: safety.reason || "Target file path blocked by safety policy",
    };
  }

  const parentDir = path.dirname(resolvedPath);
  if (!fs.existsSync(parentDir)) {
    return {
      success: false,
      status: "FAILED",
      action: "saveapp",
      filePath: resolvedPath,
      error: `Target directory '${parentDir}' does not exist`,
    };
  }

  if (fs.existsSync(resolvedPath) && options.overwrite !== true) {
    return {
      success: false,
      status: "AWAITING_APPROVAL",
      action: "saveapp",
      filePath: resolvedPath,
      requiresApproval: true,
      existingFileProtected: true,
      error: `File '${resolvedPath}' already exists. Explicit overwrite approval is required to prevent data loss.`,
    };
  }

  const targetApp = options.targetApp || "notepad";
  const expectedB64 = options.expectedContent
    ? Buffer.from(options.expectedContent, "utf8").toString("base64")
    : "";

  const psResult = await runDesktopControl<SaveDesktopAppResult>([
    "-Action",
    "saveapp",
    "-TargetWindow",
    targetApp,
    "-FilePath",
    resolvedPath,
    "-Overwrite",
    options.overwrite === true ? "true" : "false",
    "-ExpectedTextBase64",
    expectedB64,
  ]);

  if (fs.existsSync(resolvedPath)) {
    const diskVerification = verifySavedDesktopFile(resolvedPath, options.expectedContent);
    if (!diskVerification.verified) {
      return {
        ...psResult,
        ...diskVerification,
      };
    }
    return {
      ...psResult,
      success: true,
      status: "SUCCESS",
      filePath: resolvedPath,
      fileExists: true,
      verified: true,
      savedLength: diskVerification.savedLength,
    };
  }

  return {
    ...psResult,
    status: psResult.status || (psResult.success ? "PARTIAL_SUCCESS" : "FAILED"),
    filePath: resolvedPath,
  };
}



