import { IntentEnum } from "../runtime/semantic/semanticTypes.js";

export function isActionIntent(intent: string | undefined): boolean {
  if (!intent) return false;
  const normalized = intent.toLowerCase();
  return (
    normalized === "system_control" ||
    normalized === "file_operation" ||
    normalized === "browser_action" ||
    normalized === "app_launch" ||
    normalized === IntentEnum.SYSTEM_ACTION ||
    normalized === IntentEnum.APP_LAUNCH
  );
}

export function hasVerifiedSuccessfulExecution(
  executionResults: Array<{ tool: string; result: unknown }>
): boolean {
  if (!executionResults || executionResults.length === 0) {
    return false;
  }
  return executionResults.some((entry) => {
    const res = entry.result as Record<string, unknown> | null;
    if (!res) return false;
    if (res.success === false) return false;
    if (res.error) return false;
    return (
      res.success === true ||
      typeof entry.result === "string" ||
      !!res.message ||
      !!res.resolvedPath
    );
  });
}

export function enforceActionExecutionGuard(
  intent: string | undefined,
  executionResults: Array<{ tool: string; result: unknown }>,
  llmResponse: string
): { allowed: boolean; guardedResponse: string } {
  if (!isActionIntent(intent)) {
    return { allowed: true, guardedResponse: llmResponse };
  }

  const verified = hasVerifiedSuccessfulExecution(executionResults);
  if (verified) {
    return { allowed: true, guardedResponse: llmResponse };
  }

  return {
    allowed: false,
    guardedResponse: "I couldn't execute that action because no valid tool execution succeeded.",
  };
}
