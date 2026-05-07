// ════════════════════════════════════════════════════════════════════════════════
// src/voice/output.ts — Text-to-speech using Piper TTS
// ════════════════════════════════════════════════════════════════════════════════

import { env } from "@config/index.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("voice/output");

/**
 * Speak text aloud using Piper TTS.
 * Requires piper binary and voice model to be installed.
 */
export async function speak(text: string): Promise<void> {
  if (!env.VOICE_ENABLED) return;

  log.info(`Speaking: "${text.slice(0, 60)}..."`);

  try {
    // Piper TTS runs as an external process
    const proc = Bun.spawn(
      ["piper", "--model", env.PIPER_VOICE, "--output-raw"],
      { stdin: "pipe", stdout: "pipe" }
    );

    proc.stdin.write(text);
    proc.stdin.end();

    // TODO: Pipe stdout to speaker for audio playback
    await proc.exited;
    log.info("Speech complete");
  } catch (e) {
    log.warn("TTS failed — piper may not be installed", { error: String(e) });
  }
}

/**
 * Speak with a notification sound before the text.
 */
export async function speakWithChime(text: string): Promise<void> {
  // TODO: Play a chime sound before speaking
  await speak(text);
}
