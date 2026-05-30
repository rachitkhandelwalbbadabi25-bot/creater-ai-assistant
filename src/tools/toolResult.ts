export interface ToolResult {
  success: boolean;
  verified: boolean;
  toolId: string;
  message: string;
  durationMs: number;
  data?: unknown;
  error?: string;
}

export function isToolResult(value: unknown): value is ToolResult {
  return (
    !!value &&
    typeof value === "object" &&
    "toolId" in value &&
    "success" in value &&
    "verified" in value &&
    "message" in value &&
    "durationMs" in value
  );
}

export function createToolSuccess(
  toolId: string,
  startedAt: number,
  message: string,
  options?: {
    verified?: boolean;
    data?: unknown;
  }
): ToolResult {
  const result: ToolResult = {
    success: true,
    verified: options?.verified ?? true,
    toolId,
    message,
    durationMs: Date.now() - startedAt,
  };

  if (options?.data !== undefined) {
    result.data = options.data;
  }

  console.log("[TOOL RESULT RESOLVED]", result);
  return result;
}

export function createToolFailure(
  toolId: string,
  startedAt: number,
  message: string,
  error?: string,
  data?: unknown
): ToolResult {
  const result: ToolResult = {
    success: false,
    verified: false,
    toolId,
    message,
    durationMs: Date.now() - startedAt,
    error,
  };

  if (data !== undefined) {
    result.data = data;
  }

  console.log("[TOOL RESULT RESOLVED]", result);
  return result;
}

export async function withToolTimeout<T>(promise: Promise<T>, timeoutMs: number, toolId: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`${toolId} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

export function normalizeToolResult(
  toolId: string,
  startedAt: number,
  raw: unknown,
  fallbackMessage: string
): ToolResult {
  if (isToolResult(raw)) {
    return {
      ...raw,
      toolId: raw.toolId || toolId,
      durationMs: raw.durationMs || Date.now() - startedAt,
    };
  }

  if (typeof raw === "string") {
    return createToolSuccess(toolId, startedAt, raw, { verified: true, data: raw });
  }

  if (raw && typeof raw === "object" && "success" in raw) {
    const anyRaw = raw as Record<string, unknown>;
    const success = anyRaw.success === true;
    const verified = anyRaw.verified === true || (success && anyRaw.verified === undefined);
    const message =
      typeof anyRaw.message === "string"
        ? anyRaw.message
        : success
          ? fallbackMessage
          : typeof anyRaw.error === "string"
            ? anyRaw.error
            : `${toolId} failed`;

    return {
      success,
      verified,
      toolId,
      message,
      durationMs: Date.now() - startedAt,
      data: raw,
      error: typeof anyRaw.error === "string" ? anyRaw.error : undefined,
    };
  }

  return createToolSuccess(toolId, startedAt, fallbackMessage, {
    verified: true,
    data: raw,
  });
}
