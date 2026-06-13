import { IntentEnum, ExecutionModeEnum } from "./semanticTypes.js";

export interface SemanticPayload {
  /** Original raw user input – kept only for debugging/observability */
  originalInput: string;

  /** Primary intent detected by the semantic engine */
  intent: IntentEnum;

  /** Optional higher‑level query extracted from the input */
  query?: string;

  /** Optional target resource (e.g., browser, app) */
  target?: string;

  /** Optional extracted entities */
  entities?: Record<string, string>;

  /** Overall confidence of the detected intent */
  confidence: number;

  /** Execution mode derived from confidence */
  executionMode: ExecutionModeEnum;

  /** Source of the payload – where it originated */
  executionSource?: "semantic" | "fallback";

  /** Optional ranking of alternative intents */
  intentConfidence?: Record<string, number>;

  /** Optional metadata for tracing */
  metadata?: {
    normalizedInput?: string;
    extractedAt?: number;
  };

  /** Optional lightweight timing observability */
  timing?: {
    extractionMs?: number;
    routingMs?: number;
    executionMs?: number;
  };

  /** Semantic contract version – used for future migrations */
  semanticVersion?: "x-factor-x3";

  /** Timestamp of payload creation (ms since epoch) */
  timestamp: number;
}
