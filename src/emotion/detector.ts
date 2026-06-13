import { matchKeywords, type Mood, type EnergyLevel } from "./keywords.js";

export interface EmotionDetection {
  mood: Mood;
  energy: EnergyLevel;
  confidence: number;
  source: "keyword" | "ml" | "combined";
}

export async function detectEmotion(text: string): Promise<EmotionDetection> {
  const keywordResult = matchKeywords(text);
  const { classifyEmotion, isMLAvailable } = await import("./xenova.js");

  if (!isMLAvailable()) {
    if (keywordResult) {
      return {
        mood: keywordResult.mood,
        energy: keywordResult.energy,
        confidence: keywordResult.weight,
        source: "keyword",
      };
    }
    return {
      mood: "neutral",
      energy: "medium",
      confidence: 0.3,
      source: "keyword",
    };
  }

  const mlResult = await classifyEmotion(text);

  if (keywordResult && mlResult) {
    if (keywordResult.mood === mlResult.mood) {
      return {
        mood: keywordResult.mood,
        energy: keywordResult.energy,
        confidence: Math.min((keywordResult.weight + mlResult.confidence) / 2 + 0.15, 1.0),
        source: "combined",
      };
    }

    if (mlResult.confidence > keywordResult.weight) {
      return {
        mood: mlResult.mood,
        energy: mlResult.energy,
        confidence: mlResult.confidence * 0.9,
        source: "ml",
      };
    }

    return {
      mood: keywordResult.mood,
      energy: keywordResult.energy,
      confidence: keywordResult.weight * 0.9,
      source: "keyword",
    };
  }

  if (keywordResult) {
    return {
      mood: keywordResult.mood,
      energy: keywordResult.energy,
      confidence: keywordResult.weight,
      source: "keyword",
    };
  }

  if (mlResult) {
    return {
      mood: mlResult.mood,
      energy: mlResult.energy,
      confidence: mlResult.confidence,
      source: "ml",
    };
  }

  return {
    mood: "neutral",
    energy: "medium",
    confidence: 0.3,
    source: "keyword",
  };
}

export function detectEmotionFast(text: string): EmotionDetection {
  const kw = matchKeywords(text);
  if (kw) {
    return { mood: kw.mood, energy: kw.energy, confidence: kw.weight, source: "keyword" };
  }
  return { mood: "neutral", energy: "medium", confidence: 0.3, source: "keyword" };
}
