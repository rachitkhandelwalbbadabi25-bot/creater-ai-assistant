// ════════════════════════════════════════════════════════════════════════════════
// src/voice/input.ts — Speech-to-text using Whisper.cpp
// ════════════════════════════════════════════════════════════════════════════════

import { env } from "@config/index.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("voice/input");

/**
 * Transcribe an audio file to text using Whisper.
 * Requires whisper.cpp model to be downloaded separately.
 */
export async function transcribeAudio(audioFilePath: string): Promise<string> {
  if (!env.VOICE_ENABLED) {
    log.warn("Voice is disabled — set VOICE_ENABLED=true in .env");
    return "";
  }

  log.info(`Transcribing: ${audioFilePath}`);

  try {
    // Dynamic import — only loads when voice is enabled
    const { nodewhisper } = await import("nodejs-whisper");
    const result = await nodewhisper(audioFilePath, {
      modelName: env.WHISPER_MODEL,
      autoDownloadModelName: env.WHISPER_MODEL,
    });
    const text = typeof result === "string" ? result : String(result);
    log.info(`Transcription: "${text.slice(0, 100)}..."`);
    return text.trim();
  } catch (e) {
    log.error("Transcription failed", e);
    return "";
  }
}

/**
 * Start recording from microphone and transcribe when done.
 * Returns the transcribed text.
 */
export async function listenAndTranscribe(): Promise<string> {
  if (!env.VOICE_ENABLED) return "";

  log.info("Listening for voice input...");

  // TODO: Implement mic recording → temp file → transcribe pipeline
  // This requires node-microphone or record-to-file
  log.warn("Live mic transcription not yet implemented");
  return "";
}
