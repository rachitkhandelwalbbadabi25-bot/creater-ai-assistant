// ════════════════════════════════════════════════════════════════════════════════
// src/emotion/xenova.ts — Local transformer-based emotion classification
// Uses @xenova/transformers for offline ML inference (no API calls needed)
// ════════════════════════════════════════════════════════════════════════════════

import { createLogger } from "@utils/logger.js";
import type { Mood, EnergyLevel } from "./keywords.js";

const log = createLogger("emotion/xenova");

// ─── Types ────────────────────────────────────────────────────────────────────────
export interface MLEmotionResult {
  mood: Mood;
  energy: EnergyLevel;
  confidence: number;
  rawLabel: string;
  rawScore: number;
}

// ─── Model State ──────────────────────────────────────────────────────────────────
const isBun = typeof (globalThis as any).Bun !== "undefined";
const isWindows = process.platform === "win32";
const disableMLOnBunWindows = isBun && isWindows;

let classifier: any = null;
let isLoading = false;
let hasAttemptedLoad = disableMLOnBunWindows;
export let mlAvailable = false; // stays false until model successfully loads

if (disableMLOnBunWindows) {
  log.info("Bun on Windows detected. Bypassing local ML emotion model to prevent native ONNX runtime hangs/deadlocks.");
}

export function isMLAvailable(): boolean {
  return mlAvailable || !hasAttemptedLoad;
}

// Label mapping: transformer output labels → our Mood types
const LABEL_TO_MOOD: Record<string, Mood> = {
  joy: "happy",
  happiness: "happy",
  love: "happy",
  sadness: "sad",
  grief: "sad",
  anger: "angry",
  annoyance: "angry",
  disgust: "angry",
  fear: "anxious",
  nervousness: "anxious",
  surprise: "excited",
  excitement: "excited",
  amusement: "happy",
  gratitude: "grateful",
  confusion: "confused",
  disappointment: "frustrated",
  frustration: "frustrated",
  tiredness: "tired",
  neutral: "neutral",
  optimism: "motivated",
  admiration: "motivated",
  pride: "motivated",
  relief: "grateful",
  desire: "motivated",
  caring: "happy",
  approval: "happy",
  disapproval: "frustrated",
  embarrassment: "anxious",
  curiosity: "neutral",
  realization: "neutral",
  remorse: "sad",
};

const MOOD_ENERGY: Record<Mood, EnergyLevel> = {
  happy: "high",
  sad: "low",
  angry: "high",
  anxious: "medium",
  excited: "high",
  frustrated: "medium",
  neutral: "medium",
  tired: "low",
  stressed: "medium",
  grateful: "medium",
  confused: "medium",
  motivated: "high",
};

// ─── Lazy Model Loading ───────────────────────────────────────────────────────────
/**
 * Lazily loads the emotion classification model on first use.
 * Uses a small, fast model suitable for real-time classification.
 */
async function getClassifier(): Promise<any> {
  if (classifier) return classifier;
  if (hasAttemptedLoad && !classifier) return null;
  if (isLoading) {
    // Wait for in-progress load
    while (isLoading) await new Promise((r) => setTimeout(r, 100));
    return classifier;
  }

  isLoading = true;
  hasAttemptedLoad = true;
  try {
    log.info("Loading emotion classifier model...");
    
    // Dynamic import and pipeline initialization
    const loadPromise = (async () => {
      const { pipeline, env: tfEnv } = await import("@xenova/transformers");
      // Point to the correct HuggingFace Hub CDN and allow local cache first
      tfEnv.remoteHost = "https://huggingface.co/";
      tfEnv.remotePathTemplate = "{model}/resolve/{revision}/";
      tfEnv.allowLocalModels = true;
      return await pipeline(
        "text-classification",
        "SamLowe/roberta-base-go_emotions-onnx",
        { 
          quantized: true, // Use the 125MB quantized model
          progress_callback: (info: any) => {
            if (info.status === "progress") {
              log.info(`Downloading Emotion model... ${(info.progress as number).toFixed(1)}%`);
            }
          }
        } 
      );
    })();

    // 30s timeout — enough for a cached model to load, prevents hanging on bad network
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("HuggingFace model load timed out after 30s")), 30000);
    });

    classifier = await Promise.race([loadPromise, timeoutPromise]);
    log.info("Emotion classifier loaded successfully");
    mlAvailable = true;
    return classifier;
  } catch (e) {
    log.warn("Failed to load emotion classifier — falling back to keywords", {
      error: String(e),
    });
    mlAvailable = false;
    classifier = null;
    return null;
  } finally {
    isLoading = false;
  }
}

// ─── Classification ───────────────────────────────────────────────────────────────

/**
 * Classify the emotion of a text using the local transformer model.
 * Returns null if the model fails to load (graceful degradation).
 */
export async function classifyEmotion(text: string): Promise<MLEmotionResult | null> {
  const model = await getClassifier();
  if (!model) return null;

  try {
    const results = await model(text, { topk: 1 });
    const top = results[0];

    if (!top) return null;

    const rawLabel = (top.label as string).toLowerCase();
    const rawScore = top.score as number;
    const mood = LABEL_TO_MOOD[rawLabel] ?? "neutral";
    const energy = MOOD_ENERGY[mood];

    log.debug(`ML emotion: "${rawLabel}" (${(rawScore * 100).toFixed(1)}%) → ${mood}`, {
      text: text.slice(0, 80),
    });

    return {
      mood,
      energy,
      confidence: rawScore,
      rawLabel,
      rawScore,
    };
  } catch (e) {
    log.warn("Emotion classification failed", { error: String(e) });
    return null;
  }
}

/**
 * Preload the model (call during app startup for faster first inference).
 */
export async function preloadModel(): Promise<boolean> {
  const model = await getClassifier();
  return model !== null;
}
