import { Models } from "@config/models.js";
import { normalizeCommandInput, routeFastCommand } from "@graph/commandRouter.js";

export type RuntimeMode =
  | "conversational"
  | "execution"
  | "reasoning"
  | "retrieval"
  | "orchestration"
  | "hybrid";

export interface RuntimeModeClassification {
  mode: RuntimeMode;
  normalizedInput: string;
  confidence: number;
  reason: string;
  targetAgent?: "laptopAgent";
  intent?: "system_command" | "browser_command" | "application_launch" | "web_navigation";
  selectedModel?: string;
}

const EXECUTION_KEYWORDS = [
  /^(open|launch|start|run)\s+/i,
  /^(search|google|search google|find on google)\s+/i,
  /^(shutdown|restart|reboot|sleep|lock|sign out|log out)\b/i,
  /^(screenshot|take screenshot|capture screen)\b/i,
  /^(volume up|volume down|mute|unmute|toggle mute|increase volume|decrease volume)\b/i,
  /\bopen settings\b/i,
  /\bplay music on youtube\b/i,
];

const RETRIEVAL_KEYWORDS = [
  /\bwhat did i say earlier\b/i,
  /\bsummarize memory\b/i,
  /\bfind my notes\b/i,
  /\brecall previous tasks\b/i,
  /\bremember\b.*\b(earlier|before|previous)\b/i,
  /\bsearch memory\b/i,
];

const REASONING_KEYWORDS = [
  /^(explain|analyze|analyse|compare|teach me|walk me through)\b/i,
  /\bwhy\b.+\?/i,
  /\bpros and cons\b/i,
];

const ORCHESTRATION_KEYWORDS = [
  /\bautomate\b/i,
  /\bschedule\b/i,
  /\bworkflow\b/i,
  /\bset up\b.+\b(reminder|monitor|automation)\b/i,
  /\bkeep an eye on\b/i,
];

const CONVERSATIONAL_KEYWORDS = [
  /^(hi|hello|hey|yo)\b/i,
  /\bhow are you\b/i,
  /\bi feel\b/i,
  /\bcan we talk\b/i,
  /\bwhat do you think\b/i,
];

function isHybridExecutionRequest(normalizedInput: string): boolean {
  return (
    /\band\b/i.test(normalizedInput) &&
    /(\bopen\b|\blaunch\b|\bplay\b|\bsearch\b|\bgoogle\b)/i.test(normalizedInput) &&
    /(\bsearch\b|\bgoogle\b|\bexplain\b|\bcompare\b|\bfind\b|\bteach\b|\bsummarize\b)/i.test(normalizedInput)
  );
}

function detectExecutionIntent(normalizedInput: string): RuntimeModeClassification | null {
  const fastCommand = routeFastCommand(normalizedInput);

  if (fastCommand) {
    const intent =
      fastCommand.kind === "open_url" || fastCommand.kind === "browser_home" || fastCommand.kind === "youtube"
        ? "web_navigation"
        : fastCommand.kind === "open_app"
          ? "application_launch"
          : fastCommand.kind === "open_path" || fastCommand.kind === "open_downloads"
            ? "system_command"
            : "system_command";

    return {
      mode: "execution",
      normalizedInput,
      confidence: 0.99,
      reason: `fast-command:${fastCommand.kind}`,
      targetAgent: "laptopAgent",
      intent,
      selectedModel: Models.FAST,
    };
  }

  const matchedExecutionKeyword = EXECUTION_KEYWORDS.find((pattern) => pattern.test(normalizedInput));
  if (!matchedExecutionKeyword) return null;

  const intent =
    /\b(youtube|browser|google|search|website|url|music)\b/i.test(normalizedInput)
      ? "web_navigation"
      : /\b(notepad|calculator|calc|chrome|edge|firefox|vscode|settings)\b/i.test(normalizedInput)
        ? "application_launch"
        : "system_command";

  return {
    mode: "execution",
    normalizedInput,
    confidence: 0.97,
    reason: `execution-pattern:${matchedExecutionKeyword.source}`,
    targetAgent: "laptopAgent",
    intent,
    selectedModel: Models.FAST,
  };
}

export function classifyRuntimeMode(input: string): RuntimeModeClassification {
  console.log("RUNTIME MODE CLASSIFIER ACTIVE");
  const normalizedInput = normalizeCommandInput(input);
  console.log("INPUT NORMALIZED", normalizedInput);

  const hasExecution = detectExecutionIntent(normalizedInput);
  const hasRetrieval = RETRIEVAL_KEYWORDS.some((pattern) => pattern.test(normalizedInput));
  const hasReasoning = REASONING_KEYWORDS.some((pattern) => pattern.test(normalizedInput));
  const hasOrchestration = ORCHESTRATION_KEYWORDS.some((pattern) => pattern.test(normalizedInput));
  const hasConversational = CONVERSATIONAL_KEYWORDS.some((pattern) => pattern.test(normalizedInput));

  if ((hasExecution && (hasReasoning || hasRetrieval || hasOrchestration)) || isHybridExecutionRequest(normalizedInput)) {
    const result: RuntimeModeClassification = {
      mode: "hybrid",
      normalizedInput,
      confidence: 0.95,
      reason: "execution-plus-nonexecution",
    };
    console.log("RUNTIME MODE DETECTED", result);
    console.log("HYBRID MODE ACTIVE");
    return result;
  }

  if (hasExecution) {
    console.log("RUNTIME MODE DETECTED", hasExecution);
    console.log("EXECUTION MODE ACTIVE");
    return hasExecution;
  }

  if (hasRetrieval) {
    const result: RuntimeModeClassification = {
      mode: "retrieval",
      normalizedInput,
      confidence: 0.94,
      reason: "retrieval-pattern",
    };
    console.log("RUNTIME MODE DETECTED", result);
    console.log("RETRIEVAL MODE ACTIVE");
    return result;
  }

  if (hasReasoning) {
    const result: RuntimeModeClassification = {
      mode: "reasoning",
      normalizedInput,
      confidence: 0.93,
      reason: "reasoning-pattern",
    };
    console.log("RUNTIME MODE DETECTED", result);
    console.log("REASONING MODE ACTIVE");
    return result;
  }

  if (hasOrchestration) {
    const result: RuntimeModeClassification = {
      mode: "orchestration",
      normalizedInput,
      confidence: 0.92,
      reason: "orchestration-pattern",
    };
    console.log("RUNTIME MODE DETECTED", result);
    console.log("ORCHESTRATION MODE ACTIVE");
    return result;
  }

  if (hasConversational) {
    const result: RuntimeModeClassification = {
      mode: "conversational",
      normalizedInput,
      confidence: 0.91,
      reason: "conversational-pattern",
    };
    console.log("RUNTIME MODE DETECTED", result);
    console.log("CONVERSATIONAL MODE ACTIVE");
    return result;
  }

  const fallback: RuntimeModeClassification = {
    mode: "conversational",
    normalizedInput,
    confidence: 0.55,
    reason: "default-conversational",
  };
  console.log("RUNTIME MODE DETECTED", fallback);
  console.log("CONVERSATIONAL MODE ACTIVE");
  return fallback;
}
