// src/runtime/semantic/semanticTypes.ts
// Exported enums for strong typing
export enum IntentEnum {
  BROWSER_SEARCH = "browser_search",
  APP_LAUNCH = "app_launch",
  SYSTEM_ACTION = "system_action",
  INFORMATION_SEARCH = "information_search",
  CONVERSATION = "conversation",
  UNKNOWN = "unknown",
  // WEB_SEARCH removed – use BROWSER_SEARCH instead
  FILE_MANAGEMENT = "file_management",
}

export enum ExecutionModeEnum {
  DETERMINISTIC = "deterministic",
  VALIDATION = "validation",
  CONVERSATION = "conversation",
}

export type SemanticIntent =
  | "browser_search"
  | "app_launch"
  | "system_action"
  | "information_search"
  | "conversation"
  | "unknown";

export interface SemanticResult {
  intent: IntentEnum | SemanticIntent;
  query?: string;
  target?: string;
  confidence: number;
  executionMode: "deterministic" | "validation" | "conversation";
  source: "semantic" | "fallback";
  requiresValidation?: boolean;
  // New optional field to carry extracted entities (e.g., person name, location)
  entities?: Record<string, string>;
}
