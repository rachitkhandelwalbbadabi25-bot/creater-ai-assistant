import { extractQuery } from "./queryExtractor.js";
import { IntentEnum, SemanticResult } from "./semanticTypes.js";
import { normalize } from "./semanticNormalizer.js";
import { extractEntities } from "./entityExtractor.js";

// Simple keyword weighting map for intents
const intentKeywords: Record<IntentEnum, string[]> = {
  [IntentEnum.BROWSER_SEARCH]: ["search", "find", "look up", "news", "google", "youtube"],
  [IntentEnum.INFORMATION_SEARCH]: ["who is", "tell me", "what is", "define", "explain"],
  [IntentEnum.APP_LAUNCH]: ["open", "launch", "start", "run"],
  [IntentEnum.SYSTEM_ACTION]: ["screenshot", "take screenshot", "record screen", "capture screen", "shutdown", "restart", "reboot", "sleep", "lock"],
  [IntentEnum.CONVERSATION]: ["hello", "hi", "hey", "good morning", "good night", "thanks", "please"],
  [IntentEnum.UNKNOWN]: [],
  [IntentEnum.FILE_MANAGEMENT]: [],
};

// Normalize intent function mapping legacy or raw strings to IntentEnum
export function normalizeIntent(intent: string): IntentEnum {
  const lower = intent.trim().toLowerCase();
  if (lower === "web_search" || lower === "browser_search" || lower === IntentEnum.BROWSER_SEARCH) {
    return IntentEnum.BROWSER_SEARCH;
  }
  if (lower === "app_launch" || lower === "application_launch" || lower === IntentEnum.APP_LAUNCH) {
    return IntentEnum.APP_LAUNCH;
  }
  if (
    lower === "system_action" ||
    lower === "system_command" ||
    lower === "system_control" ||
    lower === IntentEnum.SYSTEM_ACTION
  ) {
    return IntentEnum.SYSTEM_ACTION;
  }
  if (lower === "information_search" || lower === IntentEnum.INFORMATION_SEARCH) {
    return IntentEnum.INFORMATION_SEARCH;
  }
  if (lower === "conversation" || lower === IntentEnum.CONVERSATION) {
    return IntentEnum.CONVERSATION;
  }
  if (lower === "file_management" || lower === IntentEnum.FILE_MANAGEMENT) {
    return IntentEnum.FILE_MANAGEMENT;
  }
  return IntentEnum.UNKNOWN;
}

/**
 * Detects intent based on keyword occurrence scoring, extracts factual queries, and identifies entities.
 * Returns a SemanticResult with confidence between 0 and 1.
 */
export function detectIntent(rawInput: string): SemanticResult {
  const input = normalize(rawInput).trim();

  // High-confidence browser search regex patterns
  const browserSearchPatterns = [
    /^(?:what|who) is\s+(.+)$/i,
    /^tell me\s+(.+?)\s+(?:age|birthday|date of birth)$/i,
    /^latest\s+(.+?)\s+news$/i,
    /^search\s+(.+?)\s+(?:on google|online|on youtube)$/i,
    /^search\s+(.+)$/i,
  ];

  for (const regex of browserSearchPatterns) {
    if (regex.test(input)) {
      const result: SemanticResult = {
        intent: IntentEnum.BROWSER_SEARCH,
        confidence: 0.95,
        executionMode: "deterministic",
        source: "semantic",
      };
      const extractionResult = extractQuery(rawInput);
      if (extractionResult) {
        result.query = extractionResult.query;
        const entities = extractEntities(extractionResult.query);
        if (Object.keys(entities).length > 0) {
          result.entities = entities;
        }
      } else {
        result.query = input;
      }
      return result;
    }
  }

  // Conversational patterns check
  const conversationPatterns = [
    /^(hi|hello|hey|yo)\b/i,
    /\bhow are you\b/i,
  ];
  for (const regex of conversationPatterns) {
    if (regex.test(input)) {
      return {
        intent: IntentEnum.CONVERSATION,
        confidence: 0.95,
        executionMode: "conversation",
        source: "semantic",
      };
    }
  }

  // Simple scoring: count matches for each intent
  const scores: Record<IntentEnum, number> = {
    [IntentEnum.BROWSER_SEARCH]: 0,
    [IntentEnum.INFORMATION_SEARCH]: 0,
    [IntentEnum.APP_LAUNCH]: 0,
    [IntentEnum.SYSTEM_ACTION]: 0,
    [IntentEnum.CONVERSATION]: 0,
    [IntentEnum.UNKNOWN]: 0,
    [IntentEnum.FILE_MANAGEMENT]: 0,
  };

  for (const intent of Object.keys(intentKeywords) as IntentEnum[]) {
    const keywords = intentKeywords[intent] || [];
    for (const kw of keywords) {
      if (input.toLowerCase().includes(kw)) {
        scores[intent] += 1;
      }
    }
  }

  // Determine best intent
  const bestIntent = (Object.entries(scores) as [IntentEnum, number][]).sort((a, b) => b[1] - a[1])[0][0];
  const bestScore = scores[bestIntent];

  // Compute confidence
  const maxPossible = (intentKeywords[bestIntent] || []).length || 1;
  const confidence = bestScore / maxPossible;

  const result: SemanticResult = {
    intent: bestIntent,
    confidence: Number(confidence.toFixed(2)),
    executionMode: confidence >= 0.85 ? "deterministic" : "conversation",
    source: "semantic",
  };

  // Extract query if possible
  const extractionResult = extractQuery(rawInput);
  if (extractionResult) {
    result.query = extractionResult.query;
    const entities = extractEntities(extractionResult.query);
    if (Object.keys(entities).length > 0) {
      result.entities = entities;
    }
  } else {
    // Fallback optional fields based on intent
    if (bestIntent === IntentEnum.BROWSER_SEARCH || bestIntent === IntentEnum.INFORMATION_SEARCH) {
      result.query = rawInput;
    } else if (bestIntent === IntentEnum.APP_LAUNCH || bestIntent === IntentEnum.SYSTEM_ACTION) {
      result.target = rawInput;
    }
  }

  // If confidence is very low, fallback to unknown
  if (confidence < 0.4) {
    result.intent = IntentEnum.UNKNOWN;
    result.requiresValidation = true;
  }

  return result;
}


