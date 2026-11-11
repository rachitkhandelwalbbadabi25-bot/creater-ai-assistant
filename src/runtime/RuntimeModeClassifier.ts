import { IntentEnum } from "./semantic/semanticTypes.js";
import { Models } from "@config/models.js";
import { normalizeCommandInput, routeFastCommand } from "@graph/commandRouter.js";
import { createLogger } from "@utils/logger.js";
import { IS_RUNTIME_DEBUG, logPerf, nowMs } from "@utils/perf.js";
import { extractQuery } from "./semantic/queryExtractor.js";
import { determineExecutionMode } from "./semantic/semanticExecutionPolicy.js";
import { containsFactualAttribute } from "./semantic/intentDetector.js";

export interface RuntimeModeClassification {
  mode: RuntimeMode;
  normalizedInput: string;
  confidence: number;
  reason: string;
  detectedModes: RuntimeMode[];
  executionMode?: "deterministic" | "validation" | "conversation";
  intent?: IntentEnum;
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
    /^(open|open up|launch|start|run|go to|take me to|show me|display|bring up|locate)\s+/i,
    /^(search|google|search google|find on google|look up)\s+/i,
    /^(shutdown|restart|reboot|sleep|lock|sign out|log out)\b/i,
    /\b(screenshots?|screenshort|screen\s*shot|capture\s+(?:the\s+)?screen|take\s+(?:a\s+)?ss|take\s+(?:a\s+)?screenshot)\b/i,
    /\b(what(?:'s|\s+is)\s+(?:currently\s+)?(?:open\s+on|open\s+in|on)\s+(?:my\s+)?screen|what\s+is\s+open|inspect\s+(?:the\s+|my\s+)?(?:active\s+)?window|inspect\s+(?:the\s+|my\s+)?screen|check\s+(?:my\s+)?screen|active\s+window|screen\s*pe\s*kya\s*(?:hai|chal\s*raha\s*hai))\b/i,
    /\b(click\s+(?:at|on)?\s*\d+|move\s+mouse\s+(?:to)?\s*\d+|type\s+.+)\b/i,
    /\b(list|show)\s+(?:all\s+)?mcp\s+servers?\b/i,
    /\b(message|send\s+message|dm|text)\s+.+\s+(on|in|to)\b/i,
    /^(?:volume\b|awaz\b|awaaz\b|mute\b|unmute\b|toggle\s*mute|increase\s*(?:the\s*)?volume|decrease\s*(?:the\s*)?volume|lower\s*(?:the\s*)?volume|raise\s*(?:the\s*)?volume|turn\s*(?:up|down)\s*(?:the\s*)?volume)/i,
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
  semanticSearchIndicators: /\b(google|search|find information|look up|lookup)\b/i,
  openVerbPrefix: /^(open|open up|launch|start|run|go to|take me to|show me|display|bring up|locate|find)\s+/i,
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



const LIVE_DATA_CATEGORIES = [
  "news",
  "weather",
  "temperature",
  "forecast",
  "price",
  "stock",
  "market",
  "crypto",
  "bitcoin",
  "btc",
  "eth",
  "rate",
  "gold",
  "score",
  "match",
  "game",
  "captain",
  "standings",
  "tournament",
  "election",
  "ceo",
  "net worth",
  "president",
  "prime minister",
  "announcement",
  "announcements",
  "update",
  "updates",
  "event",
  "events",
  "release",
];

const CONVERSATIONAL_SELF_PATTERNS = [
  /\bwhat are you doing\b/i,
  /\bwhat should i\b/i,
  /\bhelp me\b/i,
  /\btell me what you\b/i,
  /\bwhy is this happening\b/i,
  /\bcan you explain\b/i,
  /\bwhat do you think\b/i,
  /\bare you free\b/i,
  /\btalk to me\b/i,
];

function isExternalTemporalInfoRequest(normalizedInput: string, rawInput: string): boolean {
  const inputLower = normalizedInput.toLowerCase();

  // 1. Direct conversational self/assistant patterns are NEVER temporal external info requests
  if (CONVERSATIONAL_SELF_PATTERNS.some((pattern) => pattern.test(inputLower))) {
    return false;
  }

  // 2. Explicit search indicators + temporal word
  const hasSearchIndicators = PRECOMPILED_REGEX.semanticSearchIndicators.test(inputLower);
  if (hasSearchIndicators) {
    return true;
  }

  // 3. Known live-data category (e.g. news, weather, stock, price, ceo, score, update)
  const hasLiveDataCategory = LIVE_DATA_CATEGORIES.some((cat) => inputLower.includes(cat));

  // 4. World current event / info question patterns
  const hasWorldEventPattern =
    /\bwhat(?:'s|\s+is|\s+has)\s+(?:happening|happened|new|going on)\s+in\b/i.test(inputLower) ||
    /\b(?:latest|recent|current)\s+.*\b(?:news|update|updates|announcement|announcements|release|info|information)\b/i.test(inputLower) ||
    /\bwho\s+is\s+the\s+current\b/i.test(inputLower);

  // 5. Query extraction check for external entities
  const extraction = extractQuery(normalizedInput);
  const query = extraction?.query ? extraction.query.toLowerCase() : "";
  const hasExternalEntity =
    /\b(nvidia|openai|microsoft|google|apple|tesla|bitcoin|crypto|ai|mcp|market|stocks?)\b/i.test(inputLower) ||
    (query.length > 2 && !/\b(you|me|i|bro|assistant|we|us|this|that|it)\b/i.test(query));

  if (hasLiveDataCategory || hasWorldEventPattern || (hasExternalEntity && query.length > 2)) {
    return true;
  }

  return false;
}

function detectSemanticFactualIntent(normalizedInput: string, rawInput: string = normalizedInput): RuntimeModeClassification | null {
  const isTimeSensitive = /\b(current|latest|today|now|recent|live|current captain|current score)\b/i.test(rawInput);
  const extraction = extractQuery(normalizedInput);

  if (isTimeSensitive) {
    if (isExternalTemporalInfoRequest(normalizedInput, rawInput)) {
      return {
        mode: "execution",
        normalizedInput,
        confidence: 0.95,
        reason: "time-sensitive-query",
        detectedModes: ["execution"],
        targetAgent: "laptopAgent",
        intent: IntentEnum.BROWSER_SEARCH,
        selectedModel: Models.FAST,
        executionSource: "semantic-search",
      };
    }
  }

  if (!extraction) {
    return null;
  }

  const hasSearchIndicators = PRECOMPILED_REGEX.semanticSearchIndicators.test(normalizedInput);
  const hasFactualAttribute = containsFactualAttribute(extraction.query);
  if ((!hasSearchIndicators && !hasFactualAttribute) || PRECOMPILED_REGEX.openVerbPrefix.test(normalizedInput)) {
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

function detectExecutionIntent(normalizedInput: string, rawInput: string = normalizedInput): RuntimeModeClassification | null {
  const fastCommand = routeFastCommand(rawInput);
  if (fastCommand) {
    const intent =
      fastCommand.kind === "open_url" || fastCommand.kind === "browser_home" || fastCommand.kind === "youtube"
        ? IntentEnum.BROWSER_SEARCH
        : fastCommand.kind === "open_app"
          ? IntentEnum.APP_LAUNCH
          : IntentEnum.SYSTEM_ACTION;

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
    } else if (
      fastCommand.kind === "volume" ||
      fastCommand.kind === "reminder" ||
      fastCommand.kind === "social_message" ||
      fastCommand.kind === "browser_act"
    ) {
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

  const intent = (PRECOMPILED_REGEX.webNavigationIntent.test(normalizedInput) || /^(search|google|look up|find information)\b/i.test(normalizedInput))
    ? IntentEnum.BROWSER_SEARCH
    : PRECOMPILED_REGEX.appLaunchIntent.test(normalizedInput)
      ? IntentEnum.APP_LAUNCH
      : IntentEnum.SYSTEM_ACTION;

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

  // Fast command check on raw input FIRST
  const hasExecution = detectExecutionIntent(normalizedInput, input);
  if (hasExecution) {
    logPerf(log, "classifyRuntimeMode completed", startedAt, { mode: hasExecution.mode });
    return hasExecution;
  }

  const deterministicSearch = detectDeterministicSearchIntent(normalizedInput);
  if (deterministicSearch) {
    logPerf(log, "classifyRuntimeMode completed", startedAt, { mode: deterministicSearch.mode });
    return deterministicSearch;
  }

  // Check for semantic factual queries (e.g., "tell me virat kohli age") or current info
  const semanticFactual = detectSemanticFactualIntent(normalizedInput, input);
  if (semanticFactual) {
    logPerf(log, "classifyRuntimeMode completed", startedAt, { mode: semanticFactual.mode });
    return semanticFactual;
  }

  const hasRetrieval = PRECOMPILED_REGEX.retrievalKeywords.some((pattern) => pattern.test(normalizedInput));
  const hasReasoning = PRECOMPILED_REGEX.reasoningKeywords.some((pattern) => pattern.test(normalizedInput));
  const hasOrchestration = PRECOMPILED_REGEX.orchestrationKeywords.some((pattern) => pattern.test(normalizedInput));
  const hasConversational = PRECOMPILED_REGEX.conversationalKeywords.some((pattern) => pattern.test(normalizedInput));
  const detectedModes: RuntimeMode[] = [
    ...(hasRetrieval ? ["retrieval" as const] : []),
    ...(hasReasoning ? ["reasoning" as const] : []),
    ...(hasOrchestration ? ["orchestration" as const] : []),
    ...(hasConversational ? ["conversational" as const] : []),
  ];

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
      intent: IntentEnum.CONVERSATION,
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
    intent: IntentEnum.CONVERSATION,
  };
  logPerf(log, "classifyRuntimeMode completed", startedAt, { mode: fallback.mode });
  return fallback;
}

