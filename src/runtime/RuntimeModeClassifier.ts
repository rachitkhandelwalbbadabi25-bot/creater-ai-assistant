import { IntentEnum } from "./semantic/semanticTypes.js";
import { Models } from "@config/models.js";
import { normalizeCommandInput, routeFastCommand } from "@graph/commandRouter.js";
import { createLogger } from "@utils/logger.js";
import { IS_RUNTIME_DEBUG, logPerf, nowMs } from "@utils/perf.js";
import { extractQuery } from "./semantic/queryExtractor.js";
import { determineExecutionMode } from "./semantic/semanticExecutionPolicy.js";

export interface RuntimeModeClassification {
  mode: RuntimeMode;
  normalizedInput: string;
  confidence: number;
  reason: string;
  detectedModes: RuntimeMode[];
  executionMode?: "deterministic" | "validation" | "conversation";
  intent?: "system_command" | "browser_command" | "application_launch" | "web_navigation" | IntentEnum.BROWSER_SEARCH;
  selectedModel?: string;
  executionSource?: "alias" | "semantic-search" | "direct-launch" | "system-command";
  targetAgent?: string;
}


const log = createLogger("runtime/RuntimeModeClassifier");

export type RuntimeMode =
  | "conversational"
  | "execution"
  | "reasoning"
  | "retrieval"
  | "orchestration"
  | "hybrid";

// Duplicate RuntimeModeClassification removed; using earlier definition with IntentEnum.BROWSER_SEARCH

const PRECOMPILED_REGEX = {
  deterministicSearch: [
    /^open\s+.+\s+and\s+search\s+.+$/i,
    /^search\s+.+\s+on\s+google$/i,
    /^search\s+.+\s+on\s+youtube$/i,
  ],
  executionKeywords: [
    /^(open|launch|start|run|go to)\s+/i,
    /^(search|google|search google|find on google|look up)\s+/i,
    /^(shutdown|restart|reboot|sleep|lock|sign out|log out)\b/i,
    /^(screenshot|screenshort|screen\s+shot|capture\s+screen|take\s+screenshot|take\s+a\s+screenshot|ss)\b/i,
    /^(volume up|volume down|mute|unmute|toggle mute|increase volume|decrease volume)\b/i,
    /\bopen settings\b/i,
    /\bplay music on youtube\b/i,
  ],
  retrievalKeywords: [
    /\bwhat did i say earlier\b/i,
    /\bsummarize memory\b/i,
    /\bfind my notes\b/i,
    /\brecall previous tasks\b/i,
    /\bremember\b.*\b(earlier|before|previous)\b/i,
    /\bsearch memory\b/i,
  ],
  reasoningKeywords: [
    /^(explain|analyze|analyse|compare|teach me|walk me through)\b/i,
    /\bwhy\b.+\?/i,
    /\bpros and cons\b/i,
  ],
  orchestrationKeywords: [
    /\bautomate\b/i,
    /\bschedule\b/i,
    /\bworkflow\b/i,
    /\bset up\b.+\b(reminder|monitor|automation)\b/i,
    /\bkeep an eye on\b/i,
  ],
  conversationalKeywords: [
    /^(hi|hello|hey|yo)\b/i,
    /\bhow are you\b/i,
    /\bi feel\b/i,
    /\bcan we talk\b/i,
    /\bwhat do you think\b/i,
  ],
  screenshot: /screenshot|screenshort|screen\s+shot|capture\s+screen|take\s+screenshot|take\s+a\s+screenshot|ss/i,
  webNavigationIntent: /\b(youtube|browser|google|search|website|url|music)\b/i,
  appLaunchIntent: /\b(notepad|calculator|calc|chrome|edge|firefox|vscode|settings)\b/i,
  hybridAnd: /\band\b/i,
  hybridExecution: /(\bopen\b|\blaunch\b|\bplay\b|\bsearch\b|\bgoogle\b)/i,
  hybridMixed: /(\bsearch\b|\bgoogle\b|\bexplain\b|\bcompare\b|\bfind\b|\bteach\b|\bsummarize\b)/i,
};

export function isExecutionRuntimeMode(mode: RuntimeMode): boolean {
  return mode === "execution" || mode === "hybrid";
}

export function isConversationalRuntimeMode(mode: RuntimeMode): boolean {
  return mode === "conversational" || mode === "reasoning" || mode === "retrieval";
}

function isHybridExecutionRequest(normalizedInput: string): boolean {
  return (
    PRECOMPILED_REGEX.hybridAnd.test(normalizedInput) &&
    PRECOMPILED_REGEX.hybridExecution.test(normalizedInput) &&
    PRECOMPILED_REGEX.hybridMixed.test(normalizedInput)
  );
}

function detectDeterministicSearchIntent(normalizedInput: string): RuntimeModeClassification | null {
  if (!PRECOMPILED_REGEX.deterministicSearch.some((pattern) => pattern.test(normalizedInput))) {
    return null;
  }

  if (IS_RUNTIME_DEBUG) {
    log.info("DETERMINISTIC SEARCH WORKFLOW DETECTED", { input: normalizedInput });
  }

  const classification: RuntimeModeClassification = {
    mode: "execution",
    normalizedInput,
    confidence: 0.99,
    reason: "deterministic-web-search",
    detectedModes: ["execution"],
    targetAgent: "laptopAgent",
    intent: IntentEnum.BROWSER_SEARCH,
    selectedModel: Models.FAST,
    executionSource: "semantic-search",
  };

  if (IS_RUNTIME_DEBUG) {
    log.info("EXECUTION SOURCE DETECTED", { source: classification.executionSource });
  }

  return classification;
}



function detectSemanticFactualIntent(normalizedInput: string): RuntimeModeClassification | null {
  const extraction = extractQuery(normalizedInput);
  if (!extraction) {
    return null;
  }
  const classification: RuntimeModeClassification = {
    mode: "execution",
    normalizedInput,
    confidence: 0.90,
    reason: "semantic-factual-query",
    detectedModes: ["execution"],
    targetAgent: "laptopAgent",
    intent: IntentEnum.BROWSER_SEARCH,
    selectedModel: Models.FAST,
    executionSource: "semantic-search",
  };
  if (IS_RUNTIME_DEBUG) {
    log.info("SEMANTIC FACTUAL INTENT DETECTED", { query: extraction.query, classification });
  }
  return classification;
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

    let executionSource: "alias" | "semantic-search" | "direct-launch" | "system-command" = "system-command";
    if (fastCommand.kind === "open_app" || fastCommand.kind === "youtube" || fastCommand.kind === "close_app") {
      executionSource = "alias";
    } else if (
      fastCommand.kind === "open_url" ||
      fastCommand.kind === "browser_home" ||
      fastCommand.kind === "open_path" ||
      fastCommand.kind === "open_downloads"
    ) {
      executionSource = "direct-launch";
    } else if (fastCommand.kind === "volume") {
      executionSource = "system-command";
    }

    const classification: RuntimeModeClassification = {
      mode: "execution",
      normalizedInput,
      confidence: 0.99,
      reason: `fast-command:${fastCommand.kind}`,
      detectedModes: ["execution"],
      targetAgent: "laptopAgent",
      intent,
      selectedModel: Models.FAST,
      executionSource,
    };

    if (IS_RUNTIME_DEBUG) {
      log.info("EXECUTION SOURCE DETECTED", { source: classification.executionSource });
    }

    return classification;
  }

  if (!PRECOMPILED_REGEX.executionKeywords.some((pattern) => pattern.test(normalizedInput))) {
    return null;
  }

  if (PRECOMPILED_REGEX.screenshot.test(normalizedInput)) {
    if (IS_RUNTIME_DEBUG) {
      log.info("SCREENSHOT EXECUTION INTENT DETECTED", { input: normalizedInput });
    }
  }

  const intent = PRECOMPILED_REGEX.webNavigationIntent.test(normalizedInput)
    ? "web_navigation"
    : PRECOMPILED_REGEX.appLaunchIntent.test(normalizedInput)
      ? "application_launch"
      : "system_command";

  let executionSource: "alias" | "semantic-search" | "direct-launch" | "system-command" = "system-command";
  if (PRECOMPILED_REGEX.screenshot.test(normalizedInput)) {
    executionSource = "system-command";
  } else if (/search|google|find on google|look up/i.test(normalizedInput) && !/^(open|launch|start|run)\s+(google|youtube)\b/i.test(normalizedInput)) {
    executionSource = "semantic-search";
  } else if (/notepad|calculator|calc|chrome|edge|firefox|vscode|settings/i.test(normalizedInput)) {
    executionSource = "alias";
  } else if (/shutdown|restart|reboot|sleep|lock|sign out|log out/i.test(normalizedInput)) {
    executionSource = "system-command";
  } else if (/^(open|launch|start|run)\s+/i.test(normalizedInput)) {
    executionSource = "direct-launch";
  }

  const executionMode = determineExecutionMode(0.97);
  const classification: RuntimeModeClassification = {
    mode: "execution",
    normalizedInput,
    confidence: 0.97,
    reason: "execution-pattern",
    detectedModes: ["execution"],
    targetAgent: "laptopAgent",
    intent,
    selectedModel: Models.FAST,
    executionSource,
    executionMode,
  };

  if (IS_RUNTIME_DEBUG) {
    log.info("EXECUTION SOURCE DETECTED", { source: classification.executionSource });
  }

  return classification;
}

export function classifyRuntimeMode(input: string): RuntimeModeClassification {
  const startedAt = nowMs();
  const normalizedInput = normalizeCommandInput(input);
  if (IS_RUNTIME_DEBUG) {
    log.info("Classifying runtime mode", { input, normalizedInput });
  }

  const deterministicSearch = detectDeterministicSearchIntent(normalizedInput);
  if (deterministicSearch) {
    logPerf(log, "classifyRuntimeMode completed", startedAt, { mode: deterministicSearch.mode });
    return deterministicSearch;
  }

  // Check for semantic factual queries (e.g., "tell me virat kohli age")
  const semanticFactual = detectSemanticFactualIntent(normalizedInput);
  if (semanticFactual) {
    logPerf(log, "classifyRuntimeMode completed", startedAt, { mode: semanticFactual.mode });
    return semanticFactual;
  }
  const hasExecution = detectExecutionIntent(normalizedInput);

  
  const hasRetrieval = PRECOMPILED_REGEX.retrievalKeywords.some((pattern) => pattern.test(normalizedInput));
  const hasReasoning = PRECOMPILED_REGEX.reasoningKeywords.some((pattern) => pattern.test(normalizedInput));
  const hasOrchestration = PRECOMPILED_REGEX.orchestrationKeywords.some((pattern) => pattern.test(normalizedInput));
  const hasConversational = PRECOMPILED_REGEX.conversationalKeywords.some((pattern) => pattern.test(normalizedInput));
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
    logPerf(log, "classifyRuntimeMode completed", startedAt, { mode: result.mode });
    return result;
  }

  if (hasExecution) {
    logPerf(log, "classifyRuntimeMode completed", startedAt, { mode: hasExecution.mode });
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
    logPerf(log, "classifyRuntimeMode completed", startedAt, { mode: result.mode });
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
    logPerf(log, "classifyRuntimeMode completed", startedAt, { mode: result.mode });
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
    logPerf(log, "classifyRuntimeMode completed", startedAt, { mode: result.mode });
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
    logPerf(log, "classifyRuntimeMode completed", startedAt, { mode: result.mode });
    return result;
  }

  const fallback: RuntimeModeClassification = {
    mode: "conversational",
    normalizedInput,
    confidence: 0.55,
    reason: "default-conversational",
    detectedModes: ["conversational"],
  };
  logPerf(log, "classifyRuntimeMode completed", startedAt, { mode: fallback.mode });
  return fallback;
}
