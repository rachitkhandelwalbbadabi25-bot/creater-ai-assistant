// ════════════════════════════════════════════════════════════════════════════════
// src/voice/wakeWord.ts — Wake word detection ("Hey Creater")
// ════════════════════════════════════════════════════════════════════════════════

import { env } from "@config/index.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("voice/wakeWord");

let listening = false;

/**
 * Start listening for the wake word in background.
 * When detected, calls the onWake callback.
 */
export function startWakeWordDetection(onWake: () => void): void {
  if (!env.VOICE_ENABLED) {
    log.info("Wake word detection disabled (VOICE_ENABLED=false)");
    return;
  }

  log.info(`Listening for wake word: "${env.WAKE_WORD}"`);
  listening = true;

  // TODO: Implement continuous mic monitoring with wake word detection
  // Options: Porcupine, Snowboy, or custom keyword spotting
  // For now, this is a placeholder that logs the intent.
  log.warn("Wake word detection not yet implemented — requires Porcupine or similar");
}

export function stopWakeWordDetection(): void {
  listening = false;
  log.info("Wake word detection stopped");
}

export function isListening(): boolean {
  return listening;
}
