import { extractQuery, isValidSearchQuery } from "./queryExtractor.js";
import { IntentEnum, type SemanticResult } from "./semanticTypes.js";
import { normalize } from "./semanticNormalizer.js";
import { extractEntities } from "./entityExtractor.js";

const SEARCH_INDICATORS = ["google", "search", "find", "find information", "look up"];
const CONVERSATION_INDICATORS = ["hello", "hi", "hey", "good morning", "good night", "thanks", "please"];
const APP_LAUNCH_INDICATORS = ["open", "launch", "start", "run"];
const SYSTEM_INDICATORS = ["screenshot", "take screenshot", "record screen", "capture screen", "shutdown", "restart", "reboot", "sleep", "lock"];

export const FACTUAL_ATTRIBUTES = [
  "age",
  "birthday",
  "date of birth",
  "net worth",
  "height",
  "salary",
  "wife",
  "husband",
  "career",
  "news",
];

function includesAny(input: string, values: string[]): boolean {
  return values.some((value) => input.includes(value));
}

export function containsFactualAttribute(query: string): boolean {
  const normalized = query.toLowerCase();
  return FACTUAL_ATTRIBUTES.some((attribute) => normalized.includes(attribute));
}

export function normalizeIntent(intent: string): IntentEnum {
  const lower = intent.trim().toLowerCase();
  if (lower === "web_search" || lower === "browser_search" || lower === IntentEnum.BROWSER_SEARCH) {
    return IntentEnum.BROWSER_SEARCH;
  }
  if (lower === "app_launch" || lower === "application_launch" || lower === IntentEnum.APP_LAUNCH) {
    return IntentEnum.APP_LAUNCH;
  }
  if (lower === "system_action" || lower === "system_command" || lower === "system_control" || lower === IntentEnum.SYSTEM_ACTION) {
    return IntentEnum.SYSTEM_ACTION;
  }
  if (lower === "information_search" || lower === IntentEnum.INFORMATION_SEARCH) {
    return IntentEnum.INFORMATION_SEARCH;
  }
  if (
    lower === "conversation" ||
    lower === IntentEnum.CONVERSATION ||
    lower === "chat" ||
    lower === "greeting" ||
    lower === "chitchat"
  ) {
    return IntentEnum.CONVERSATION;
  }
  if (lower === "file_management" || lower === IntentEnum.FILE_MANAGEMENT) {
    return IntentEnum.FILE_MANAGEMENT;
  }
  return IntentEnum.CONVERSATION; // Safe fallback: treat unclassified inputs as conversation
}

export function detectIntent(rawInput: string): SemanticResult {
  const input = normalize(rawInput).trim();
  const lowerInput = input.toLowerCase();
  const extractionResult = extractQuery(rawInput);
  const extractedQuery = extractionResult?.query;
  const hasValidQuery = !!extractedQuery && isValidSearchQuery(extractedQuery);
  const hasSearchIndicators = includesAny(lowerInput, SEARCH_INDICATORS);
  const hasLaunchIndicators = includesAny(lowerInput, APP_LAUNCH_INDICATORS);
  const hasSystemIndicators = includesAny(lowerInput, SYSTEM_INDICATORS);
  const hasConversationIndicators = includesAny(lowerInput, CONVERSATION_INDICATORS);

  const buildResult = (
    intent: IntentEnum,
    confidence: number,
    executionMode: "deterministic" | "validation" | "conversation",
  ): SemanticResult => {
    const result: SemanticResult = {
      intent,
      confidence,
      executionMode,
      source: "semantic",
    };

    if (intent === IntentEnum.APP_LAUNCH || intent === IntentEnum.SYSTEM_ACTION) {
      result.target = rawInput;
    } else if (hasValidQuery) {
      result.query = extractedQuery;
      const entities = extractEntities(extractedQuery!);
      if (Object.keys(entities).length > 0) {
        result.entities = entities;
      }
    }

    return result;
  };

  // Final safety override layer (Bug 4)
  if (extractedQuery && extractedQuery.length > 2) {
    if (containsFactualAttribute(extractedQuery) || includesAny(lowerInput, SEARCH_INDICATORS)) {
      return buildResult(IntentEnum.BROWSER_SEARCH, 0.95, "deterministic");
    }
  }

  if (hasValidQuery && containsFactualAttribute(extractedQuery!)) {
    return buildResult(IntentEnum.BROWSER_SEARCH, 0.95, "deterministic");
  }

  if (hasSearchIndicators) {
    return buildResult(IntentEnum.BROWSER_SEARCH, 0.9, "deterministic");
  }

  if (hasLaunchIndicators) {
    return buildResult(IntentEnum.APP_LAUNCH, 0.92, "deterministic");
  }

  if (hasSystemIndicators) {
    return buildResult(IntentEnum.SYSTEM_ACTION, 0.92, "deterministic");
  }

  if (hasConversationIndicators) {
    return buildResult(IntentEnum.CONVERSATION, 0.95, "conversation");
  }

  if (hasValidQuery) {
    return buildResult(IntentEnum.BROWSER_SEARCH, 0.85, "deterministic");
  }

  return {
  // Safe fallback: treat unclassified inputs as conversation
  intent: IntentEnum.CONVERSATION,
  confidence: 0.2,
  executionMode: "validation",
  source: "fallback",
  requiresValidation: true,
};
}
