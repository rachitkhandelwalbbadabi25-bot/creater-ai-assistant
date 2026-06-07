// ════════════════════════════════════════════════════════════════════════════════
// src/voice/input.ts — Speech-to-text using Whisper.cpp
// ════════════════════════════════════════════════════════════════════════════════

import { env } from "@config/index.js";
import { createLogger } from "@utils/logger.js";
import recorder from "node-record-lpcm16";
import { createWriteStream, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const log = createLogger("voice/input");

/**
 * Transcribe an audio file to text using Whisper.
 */
export async function transcribeAudio(audioFilePath: string): Promise<string> {
  if (!env.VOICE_ENABLED) return "";

  log.info(`Transcribing: ${audioFilePath}`);

  try {
    const { nodewhisper } = await import("nodejs-whisper");
    const result = await nodewhisper(audioFilePath, {
      modelName: env.WHISPER_MODEL,
      autoDownloadModelName: env.WHISPER_MODEL,
    });
    const text = typeof result === "string" ? result : String(result);
    return text.trim();
  } catch (e) {
    log.error("Transcription failed", e);
    return "";
  }
}

/**
 * Start recording from microphone for a fixed duration or until silence.
 */
export async function listenAndTranscribe(durationSeconds = 5): Promise<string> {
  if (!env.VOICE_ENABLED) return "";

  const tempFile = join(tmpdir(), `creater_input_${Date.now()}.wav`);
  const fileStream = createWriteStream(tempFile);

  log.info(`🎤 Listening for ${durationSeconds}s...`);

  return new Promise((resolve) => {
    const mic = recorder.record({
      sampleRate: 16000,
      threshold: 0,
      recorder: "sox", // or "ffmpeg"
    });

    mic.stream().pipe(fileStream);

    setTimeout(async () => {
      mic.stop();
      fileStream.end();
      
      log.info("Processing speech...");
      const text = await transcribeAudio(tempFile);
      
      try {
        unlinkSync(tempFile); // Cleanup
      } catch (error) {
        log.warn("Non-critical error in speech processing", { error: error instanceof Error ? error.message : String(error) });
    }
      
      resolve(text);
    }, durationSeconds * 1000);
  });
}
