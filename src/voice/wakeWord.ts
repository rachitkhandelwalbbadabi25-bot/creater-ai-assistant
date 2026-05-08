// ════════════════════════════════════════════════════════════════════════════════
// src/voice/wakeWord.ts — Wake word detection using Picovoice Porcupine
// ════════════════════════════════════════════════════════════════════════════════

import { env } from "@config/index.js";
import { createLogger } from "@utils/logger.js";
import { Porcupine, BuiltinKeyword } from "@picovoice/porcupine-node";
import recorder from "node-record-lpcm16";

const log = createLogger("voice/wakeWord");

let listening = false;
let porcupineInstance: any = null;
let micStream: any = null;

/**
 * Start listening for the wake word in background.
 */
export function startWakeWordDetection(onWake: () => void): void {
  if (!env.VOICE_ENABLED) {
    log.info("Wake word detection disabled (VOICE_ENABLED=false)");
    return;
  }

  if (!env.PICOVOICE_ACCESS_KEY) {
    log.warn("PICOVOICE_ACCESS_KEY is missing! Wake word detection won't start.");
    log.info("Get a free key at: https://console.picovoice.ai/");
    return;
  }

  try {
    // Initialize Porcupine with a built-in keyword (e.g., COMPUTER or JARVIS)
    // "Hey Creater" would require a custom .pv model file.
    porcupineInstance = new Porcupine(
      env.PICOVOICE_ACCESS_KEY,
      [BuiltinKeyword.COMPUTER],
      [0.5] // Sensitivity (0 to 1)
    );

    log.info(`Listening for wake word: "Computer" (via Porcupine)`);
    listening = true;

    // Start recording audio
    micStream = recorder.record({
      sampleRate: porcupineInstance.sampleRate,
      threshold: 0,
      device: null,
      recorder: "sox", // or "ffmpeg" or "arecord"
    }).stream();

    const frameLength = porcupineInstance.frameLength;
    let frameBuffer: Int16Array = new Int16Array(frameLength);
    let bufferIndex = 0;

    micStream.on("data", (chunk: Buffer) => {
      if (!listening || !porcupineInstance) return;

      // Convert buffer to Int16Array
      for (let i = 0; i < chunk.length; i += 2) {
        frameBuffer[bufferIndex++] = chunk.readInt16LE(i);

        if (bufferIndex === frameLength) {
          const keywordIndex = porcupineInstance.process(frameBuffer);
          if (keywordIndex >= 0) {
            log.info("Wake word detected! 🔊");
            onWake();
          }
          bufferIndex = 0;
        }
      }
    });

    micStream.on("error", (err: any) => {
      log.error("Microphone stream error", err);
      stopWakeWordDetection();
    });

  } catch (e) {
    log.error("Failed to initialize Porcupine", e);
    listening = false;
  }
}

export function stopWakeWordDetection(): void {
  listening = false;
  if (micStream) {
    micStream.destroy();
    micStream = null;
  }
  if (porcupineInstance) {
    porcupineInstance.release();
    porcupineInstance = null;
  }
  log.info("Wake word detection stopped");
}

export function isListening(): boolean {
  return listening;
}
