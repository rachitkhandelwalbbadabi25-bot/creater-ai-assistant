import { Models } from "@config/models.js";
import { normalizeCommandInput, routeFastCommand } from "@graph/commandRouter.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("runtime/RuntimeModeClassifier");

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
  detectedModes: RuntimeMode[];
  targetAgent?: "laptopAgent";
  intent?: "system_command" | "browser_command" | "application_launch" | "web_navigation" | "web_search";
  selectedModel?: string;
}

export function isExecutionRuntimeMode(mode: RuntimeMode): boolean {
  return mode === "execution" || mode === "hybrid";
}

export function isConversationalRuntimeMode(mode: RuntimeMode): boolean {
  return mode === "conversational" || mode === "reasoning" || mode === "retrieval";
}

const EXECUTION_KEYWORDS = [
  /^(open|launch|start|run)\s+/i,
  /^(search|google|search google|find on google)\s+/i,
  /^(shutdown|restart|reboot|sleep|lock|sign out|log out)\b/i,
  /^(screenshot|screenshort|screen\s+shot|capture\s+screen|take\s+screenshot|take\s+a\s+screenshot|ss)\b/i,
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

const DETERMINISTIC_SEARCH_PATTERNS = [
  /^open\s+.+\s+and\s+search\s+.+$/i,
  /^search\s+.+\s+on\s+google$/i,
  /^search\s+.+\s+on\s+youtube$/i,
];

function isHybridExecutionRequest(normalizedInput: string): boolean {
  return (
    /\band\b/i.test(normalizedInput) &&
    /(\bopen\b|\blaunch\b|\bplay\b|\bsearch\b|\bgoogle\b)/i.test(normalizedInput) &&
    /(\bsearch\b|\bgoogle\b|\bexplain\b|\bcompare\b|\bfind\b|\bteach\b|\bsummarize\b)/i.test(normalizedInput)
  );
}

function detectDeterministicSearchIntent(normalizedInput: string): RuntimeModeClassification | null {
  if (!DETERMINISTIC_SEARCH_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return null;
  }

  log.info("DETERMINISTIC SEARCH WORKFLOW DETECTED", { input: normalizedInput });

  return {
    mode: "execution",
    normalizedInput,
    confidence: 0.99,
    reason: "deterministic-web-search",
    detectedModes: ["execution"],
    targetAgent: "laptopAgent",
    intent: "web_search",
    selectedModel: Models.FAST,
  };
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
      detectedModes: ["execution"],
      targetAgent: "laptopAgent",
      intent,
      selectedModel: Models.FAST,
    };
  }

  if (EXECUTION_KEYWORDS.some((pattern) => pattern.test(normalizedInput))) {
    if (/screenshot|screenshort|screen\s+shot|capture\s+screen|take\s+screenshot|take\s+a\s+screenshot|ss/i.test(normalizedInput)) {
      log.info("SCREENSHOT EXECUTION INTENT DETECTED", { input: normalizedInput });
    }

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
      reason: "execution-pattern",
      detectedModes: ["execution"],
      targetAgent: "laptopAgent",
      intent,
      selectedModel: Models.FAST,
    };
  }

  return null;
}

export function classifyRuntimeMode(input: string): RuntimeModeClassification {
  const normalizedInput = normalizeCommandInput(input);
  console.log("RUNTIME MODE CLASSIFIER ACTIVE");
  console.log("INPUT NORMALIZED", normalizedInput);
  log.info("Classifying runtime mode", { input, normalizedInput });

  const deterministicSearch = detectDeterministicSearchIntent(normalizedInput);
  if (deterministicSearch) {
    log.info("Runtime mode detected", { classification: deterministicSearch });
    console.log("RUNTIME MODE DETECTED", deterministicSearch);
    console.log("EXECUTION SEARCH BYPASS ACTIVE");
    return deterministicSearch;
  }

  const hasExecution = detectExecutionIntent(normalizedInput);
  const hasRetrieval = RETRIEVAL_KEYWORDS.some((pattern) => pattern.test(normalizedInput));
  const hasReasoning = REASONING_KEYWORDS.some((pattern) => pattern.test(normalizedInput));
  const hasOrchestration = ORCHESTRATION_KEYWORDS.some((pattern) => pattern.test(normalizedInput));
  const hasConversational = CONVERSATIONAL_KEYWORDS.some((pattern) => pattern.test(normalizedInput));
  const detectedModes: RuntimeMode[] = [
    ...(hasExecution ? ["execution" as const] : []),
    ...(hasRetrieval ? ["retrieval" as const] : []),
    ...(hasReasoning ? ["reasoning" as const] : []),
    ...(hasOrchestration ? ["orchestration" as const] : []),
    ...(hasConversational ? ["conversational" as const] : []),
  ];

  if ((hasExecution && (hasReasoning || hasRetrieval || hasOrchestration)) || isHybridExecutionRequest(normalizedInput)) {
    const result: RuntimeModeClassification = {
      mode: "hybrid",
      normalizedInput,
      confidence: 0.95,
      reason: "execution-plus-nonexecution",
      detectedModes: detectedModes.length > 0 ? detectedModes : ["execution"],
    };
    log.info("Runtime mode detected", { classification: result });
    console.log("RUNTIME MODE DETECTED", result);
    console.log("HYBRID MODE ACTIVE");
    return result;
  }

  if (hasExecution) {
    log.info("Runtime mode detected", { classification: hasExecution });
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
      detectedModes: ["retrieval"],
    };
    log.info("Runtime mode detected", { classification: result });
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
      detectedModes: ["reasoning"],
    };
    log.info("Runtime mode detected", { classification: result });
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
      detectedModes: ["orchestration"],
    };
    log.info("Runtime mode detected", { classification: result });
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
      detectedModes: ["conversational"],
    };
    log.info("Runtime mode detected", { classification: result });
    console.log("RUNTIME MODE DETECTED", result);
    console.log("CONVERSATIONAL MODE ACTIVE");
    return result;
  }

  const fallback: RuntimeModeClassification = {
    mode: "conversational",
    normalizedInput,
    confidence: 0.55,
    reason: "default-conversational",
    detectedModes: ["conversational"],
  };
  log.info("Runtime mode detected", { classification: fallback });
  console.log("RUNTIME MODE DETECTED", fallback);
  console.log("CONVERSATIONAL MODE ACTIVE");
  return fallback;
}
