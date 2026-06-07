// src/runtime/deterministicOrchestration/normalizer.ts

import { createLogger } from "@utils/logger.js";

const log = createLogger("runtime/normalizer");

// Simple deterministic alias map – keys are regex patterns (lower‑cased) and values are the canonical command.
const aliasMap: [RegExp, string][] = [
  [/\bdownload(s?)\s+folder\b/, "downloads"],
  [/\bdownloads\s+folder\b/, "downloads"],
  [/\bscreenshort\b/, "screenshot"],
  [/\bscreen\s+shot\b/, "screenshot"],
  [/\bss\b/, "screenshot"],
  [/\btake\s+pic\b/, "screenshot"],
  [/\bopen\s+yt\b/, "open youtube"],
  [/\bvs\s+code\b/, "vscode"],
];

/**
 * Normalizes a raw command string deterministically.
 * - Lower‑cases, trims whitespace.
 * - Applies a series of alias/typo substitutions.
 * - Returns the canonical command.
 */
export function normalizeCommand(raw: string): string {
  let cmd = raw.toLowerCase().trim();
  // Collapse multiple spaces
  cmd = cmd.replace(/\s+/g, " ");

  for (const [pattern, replacement] of aliasMap) {
    if (pattern.test(cmd)) {
      const before = cmd;
      cmd = cmd.replace(pattern, replacement);
      log.info("ALIAS RESOLUTION APPLIED", { before, after: cmd, pattern: pattern.source });
      // Only first match applied to keep deterministic behaviour
      break;
    }
  }

  log.info("COMMAND NORMALIZED", { original: raw, normalized: cmd });
  return cmd;
}
