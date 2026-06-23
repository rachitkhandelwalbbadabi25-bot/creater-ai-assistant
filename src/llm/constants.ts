// src/llm/constants.ts
// Single source of truth for Ollama runtime constants.
// Changing these values affects every agent simultaneously.

/**
 * Ollama context window size for all inference calls.
 * MUST be identical across every caller — mismatches force a runner reload
 * which costs 3–17 seconds on this hardware.
 * Validated: 2048 is sufficient for all current use cases.
 */
export const DEFAULT_NUM_CTX = 2048;

/**
 * Default keep_alive duration. Mirrors OLLAMA_KEEP_ALIVE env var.
 * Agents should use env.OLLAMA_KEEP_ALIVE — this constant is for reference only.
 */
export const DEFAULT_KEEP_ALIVE = "30m";
