// ════════════════════════════════════════════════════════════════════════════════
// src/voice/output.ts — Text-to-speech using Piper TTS and audio playback
// ════════════════════════════════════════════════════════════════════════════════

import { env } from "@config/index.js";
import { createLogger } from "@utils/logger.js";
import { spawn } from "child_process";
import playerLib from "play-sound";

const log = createLogger("voice/output");
const player = (playerLib as any)();

/**
 * Speak text aloud using Piper TTS.
 * This pipes Piper's output directly to a media player (aplay/ffplay/etc).
 */
export async function speak(text: string): Promise<void> {
  if (!env.VOICE_ENABLED) return;

  log.info(`Speaking: "${text.slice(0, 60)}..."`);

  try {
    // 1. Generate speech using Piper
    // On Windows, we usually pipe to ffplay or similar.
    // Command: piper --model model.onnx --output-raw | ffplay -ar 22050 -ac 1 -f s16le -
    const piper = spawn("piper", [
      "--model", env.PIPER_VOICE,
      "--output-raw"
    ]);

    const play = spawn("ffplay", [
      "-nodisp", "-autoexit",
      "-ar", "22050", "-ac", "1", "-f", "s16le", "-"
    ]);

    piper.stdout.pipe(play.stdin);
    piper.stdin.write(text);
    piper.stdin.end();

    return new Promise((resolve) => {
      play.on("close", () => {
        log.info("Speech complete");
        resolve();
      });
    });
  } catch (e) {
    log.warn("TTS failed — check if piper and ffplay are installed", { error: String(e) });
  }
}

/**
 * Play a notification sound.
 */
export async function playChime(): Promise<void> {
  // TODO: Add a chime.mp3 to assets
  log.info("🔔 [Chime]");
}

/**
 * Speak with a notification sound before the text.
 */
export async function speakWithChime(text: string): Promise<void> {
  await playChime();
  await speak(text);
}
