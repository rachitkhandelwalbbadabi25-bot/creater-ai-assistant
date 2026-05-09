// ════════════════════════════════════════════════════════════════════════════════
// src/voice/wakeWord.ts — Wake word detection using Picovoice Porcupine & PvRecorder
// ════════════════════════════════════════════════════════════════════════════════

import { env } from "@config/index.js";
import { createLogger } from "@utils/logger.js";
import { Porcupine, BuiltinKeyword } from "@picovoice/porcupine-node";
import { PvRecorder } from "@picovoice/pvrecorder-node";
import { EventEmitter } from "events";

const log = createLogger("voice/wakeWord");

export const voiceEvents = new EventEmitter();

let porcupine: Porcupine | null = null;
let recorder: PvRecorder | null = null;
let isInterrupted = false;
let isListening = false;

/**
 * Start listening for the wake word in background.
 * Phase 1: Basic Detection & "Listening..." feedback.
 */
export async function startWakeWordDetection(onWake: () => void) {
  if (!env.VOICE_ENABLED) {
    log.info("Voice Wake Word is disabled in .env");
    return;
  }

  if (!env.PICOVOICE_ACCESS_KEY) {
    log.warn("PICOVOICE_ACCESS_KEY missing! Wake word won't start.");
    log.info("Please get your key from: https://console.picovoice.ai/");
    return;
  }

  try {
    // 1. Initialize Porcupine
    let keywords: string[] = [];

    if (env.PICOVOICE_KEYWORD_PATH && env.PICOVOICE_KEYWORD_PATH.trim() !== "") {
      log.info(`Using custom wake word from: ${env.PICOVOICE_KEYWORD_PATH}`);
      keywords.push(env.PICOVOICE_KEYWORD_PATH);
      log.info(`Wake word detector initialized: Listening for "Hey Creater" 🔊`);
    } else {
      log.warn("Custom wake word not found! Falling back to built-in keyword 'JARVIS'.");
      log.info("To use 'Hey Creater', add PICOVOICE_KEYWORD_PATH to your .env");
      keywords.push(BuiltinKeyword.JARVIS);
      log.info(`Wake word detector initialized: Listening for "Jarvis" 🔊`);
    }

    porcupine = new Porcupine(
      env.PICOVOICE_ACCESS_KEY,
      keywords,
      [0.6] // Sensitivity
    );

    // 2. Initialize Recorder
    // PvRecorder is cross-platform and doesn't need external binaries like sox.
    recorder = new PvRecorder(porcupine.frameLength);
    
    recorder.start();
    isInterrupted = false;

    // 3. Main Loop
    const MAX_RECORD_SECONDS = 15;
    const SILENCE_SECONDS_THRESHOLD = 2; // Stop after 2s of silence
    const RMS_THRESHOLD = 50; // Needs tuning based on mic

    let audioBuffer: number[] = [];
    let silenceFrames = 0;
    const framesPerSecond = 16000 / porcupine.frameLength;
    const maxFrames = MAX_RECORD_SECONDS * framesPerSecond;
    const silenceFramesThreshold = SILENCE_SECONDS_THRESHOLD * framesPerSecond;

    while (!isInterrupted) {
      const pcm = await recorder.read();

      if (!isListening) {
        const keywordIndex = porcupine.process(pcm);

        if (keywordIndex >= 0) {
          log.info("Wake word detected! Switching to Active Listening... 📣");
          isListening = true;
          audioBuffer = [];
          silenceFrames = 0;
          voiceEvents.emit("wake");
          onWake();
        }
      } else {
        // Active Listening Phase
        audioBuffer.push(...pcm);

        // VAD Logic (Root Mean Square)
        let sum = 0;
        for (let i = 0; i < pcm.length; i++) {
          sum += pcm[i] * pcm[i];
        }
        const rms = Math.sqrt(sum / pcm.length);

        if (rms < RMS_THRESHOLD) {
          silenceFrames++;
        } else {
          silenceFrames = 0; // reset
        }

        // Stop conditions
        if (silenceFrames >= silenceFramesThreshold || audioBuffer.length >= maxFrames * porcupine.frameLength) {
          log.info("Finished listening. Processing audio...");
          isListening = false;
          voiceEvents.emit("processing_speech");
          
          // Send to STT
          const pcmData = new Int16Array(audioBuffer);
          import("./stt.js").then(({ transcribeAudio }) => {
            return transcribeAudio(pcmData);
          }).then((text) => {
            log.info(`Transcription: "${text}"`);
            if (text.length > 2) {
              voiceEvents.emit("transcribed", text);
            } else {
              voiceEvents.emit("idle");
            }
          }).catch(e => {
            log.error("Transcription failed", e);
            voiceEvents.emit("idle");
          });
        }
      }
    }

  } catch (error: any) {
    log.error("Wake Word Detection Error", error);
    stopWakeWordDetection();
  }
}

/**
 * Stop the background listener and release resources.
 */
export function stopWakeWordDetection() {
  isInterrupted = true;
  if (recorder) {
    recorder.stop();
    recorder.release();
    recorder = null;
  }
  if (porcupine) {
    porcupine.release();
    porcupine = null;
  }
  log.info("Wake word detection service stopped.");
}
