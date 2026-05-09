// ════════════════════════════════════════════════════════════════════════════════
// src/voice/stt.ts — Local Speech-to-Text using Xenova Transformers (Whisper)
// ════════════════════════════════════════════════════════════════════════════════

import { pipeline } from '@xenova/transformers';
import { createLogger } from '@utils/logger.js';
import { env } from '@config/index.js';

const log = createLogger('voice/stt');

let transcriber: any = null;

/**
 * Initializes the local Whisper model.
 * Downloads the model on first run and caches it locally.
 */
export async function initSTT() {
  if (transcriber) return transcriber;
  try {
    // whisper-base is recommended for better Hinglish accuracy
    const model = env.WHISPER_MODEL === 'base' ? 'Xenova/whisper-base' : 'Xenova/whisper-tiny';
    
    log.info(`Loading local STT model (${model})...`);
    log.info(`⏳ NOTE: On the first run, it will download a ~140MB model. Please ensure you have internet access.`);
    
    transcriber = await pipeline('automatic-speech-recognition', model);
    log.info('STT model loaded successfully. Ready for transcription.');
    return transcriber;
  } catch (error) {
    log.error('❌ Failed to load Whisper STT model!');
    log.error('Please ensure you have an active internet connection for the first-time model download (~140MB).');
    log.error('Error details:', error);
    throw error;
  }
}

/**
 * Transcribes raw 16-bit PCM audio data to text.
 * @param pcmInt16 Raw audio data from PvRecorder
 * @returns Transcribed text string
 */
export async function transcribeAudio(pcmInt16: Int16Array): Promise<string> {
  if (!transcriber) {
    await initSTT();
  }

  // Convert 16-bit PCM (-32768 to 32767) to 32-bit Float (-1.0 to 1.0)
  // This is the format required by the Whisper model.
  const pcmFloat32 = new Float32Array(pcmInt16.length);
  for (let i = 0; i < pcmInt16.length; i++) {
    pcmFloat32[i] = pcmInt16[i] / 32768.0;
  }

  try {
    const result = await transcriber(pcmFloat32, {
      chunk_length_s: 30,
      stride_length_s: 5,
    });

    return result.text.trim();
  } catch (error) {
    log.error('Transcription failed:', error);
    return '';
  }
}
