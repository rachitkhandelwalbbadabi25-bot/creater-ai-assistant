// ════════════════════════════════════════════════════════════════════════════════
// src/emotion/keywords.ts — Hinglish + English emotion keyword dictionary
// ════════════════════════════════════════════════════════════════════════════════

export type Mood =
  | "happy" | "sad" | "angry" | "anxious" | "excited"
  | "frustrated" | "neutral" | "tired" | "stressed"
  | "grateful" | "confused" | "motivated";

export type EnergyLevel = "high" | "medium" | "low";

export interface KeywordMatch {
  mood: Mood;
  energy: EnergyLevel;
  weight: number; // 0.0–1.0, how strongly this keyword indicates the mood
}

// ─── Keyword Map ──────────────────────────────────────────────────────────────────
// Each key is a lowercase keyword/phrase. Value is the mood it indicates.
// Includes English, Hindi, and Hinglish variants.

export const EMOTION_KEYWORDS: Record<string, KeywordMatch> = {
  // ── Happy / Positive ────────────────────────────────────────────────────────
  "happy":        { mood: "happy", energy: "high", weight: 0.8 },
  "khush":        { mood: "happy", energy: "high", weight: 0.8 },
  "mast":         { mood: "happy", energy: "high", weight: 0.7 },
  "awesome":      { mood: "happy", energy: "high", weight: 0.8 },
  "amazing":      { mood: "happy", energy: "high", weight: 0.8 },
  "great":        { mood: "happy", energy: "high", weight: 0.6 },
  "badhiya":      { mood: "happy", energy: "high", weight: 0.7 },
  "accha laga":   { mood: "happy", energy: "medium", weight: 0.7 },
  "maja aa gaya": { mood: "happy", energy: "high", weight: 0.9 },
  "yay":          { mood: "happy", energy: "high", weight: 0.7 },
  "woohoo":       { mood: "happy", energy: "high", weight: 0.9 },

  // ── Excited ─────────────────────────────────────────────────────────────────
  "excited":      { mood: "excited", energy: "high", weight: 0.9 },
  "pumped":       { mood: "excited", energy: "high", weight: 0.8 },
  "hyped":        { mood: "excited", energy: "high", weight: 0.8 },
  "can't wait":   { mood: "excited", energy: "high", weight: 0.8 },
  "bohot excited":{ mood: "excited", energy: "high", weight: 0.9 },

  // ── Sad ─────────────────────────────────────────────────────────────────────
  "sad":          { mood: "sad", energy: "low", weight: 0.8 },
  "dukhi":        { mood: "sad", energy: "low", weight: 0.8 },
  "udaas":        { mood: "sad", energy: "low", weight: 0.8 },
  "feeling down": { mood: "sad", energy: "low", weight: 0.7 },
  "low feel":     { mood: "sad", energy: "low", weight: 0.7 },
  "acha nahi lag raha": { mood: "sad", energy: "low", weight: 0.8 },
  "depressed":    { mood: "sad", energy: "low", weight: 0.9 },
  "lonely":       { mood: "sad", energy: "low", weight: 0.7 },
  "akela":        { mood: "sad", energy: "low", weight: 0.7 },

  // ── Angry ───────────────────────────────────────────────────────────────────
  "angry":        { mood: "angry", energy: "high", weight: 0.8 },
  "gussa":        { mood: "angry", energy: "high", weight: 0.8 },
  "pissed":       { mood: "angry", energy: "high", weight: 0.8 },
  "annoyed":      { mood: "angry", energy: "medium", weight: 0.6 },
  "irritated":    { mood: "angry", energy: "medium", weight: 0.6 },
  "chidh":        { mood: "angry", energy: "medium", weight: 0.6 },

  // ── Frustrated ──────────────────────────────────────────────────────────────
  "frustrated":   { mood: "frustrated", energy: "medium", weight: 0.8 },
  "stuck":        { mood: "frustrated", energy: "medium", weight: 0.6 },
  "ugh":          { mood: "frustrated", energy: "medium", weight: 0.7 },
  "argh":         { mood: "frustrated", energy: "medium", weight: 0.7 },
  "kuch samajh nahi aa raha": { mood: "frustrated", energy: "medium", weight: 0.8 },
  "ho nahi raha": { mood: "frustrated", energy: "low", weight: 0.7 },
  "fed up":       { mood: "frustrated", energy: "low", weight: 0.8 },

  // ── Stressed / Anxious ──────────────────────────────────────────────────────
  "stressed":     { mood: "stressed", energy: "medium", weight: 0.8 },
  "tension":      { mood: "stressed", energy: "medium", weight: 0.7 },
  "pressure":     { mood: "stressed", energy: "medium", weight: 0.6 },
  "deadline":     { mood: "stressed", energy: "medium", weight: 0.5 },
  "anxious":      { mood: "anxious", energy: "medium", weight: 0.8 },
  "nervous":      { mood: "anxious", energy: "medium", weight: 0.7 },
  "ghabra":       { mood: "anxious", energy: "medium", weight: 0.7 },
  "worried":      { mood: "anxious", energy: "medium", weight: 0.7 },
  "chinta":       { mood: "anxious", energy: "medium", weight: 0.7 },
  "fikar":        { mood: "anxious", energy: "medium", weight: 0.7 },
  "overwhelmed":  { mood: "stressed", energy: "low", weight: 0.9 },

  // ── Tired ───────────────────────────────────────────────────────────────────
  "tired":        { mood: "tired", energy: "low", weight: 0.8 },
  "thak gaya":    { mood: "tired", energy: "low", weight: 0.9 },
  "exhausted":    { mood: "tired", energy: "low", weight: 0.9 },
  "sleepy":       { mood: "tired", energy: "low", weight: 0.7 },
  "neend aa rahi":{ mood: "tired", energy: "low", weight: 0.8 },
  "drained":      { mood: "tired", energy: "low", weight: 0.9 },
  "burnt out":    { mood: "tired", energy: "low", weight: 0.9 },

  // ── Grateful ────────────────────────────────────────────────────────────────
  "thanks":       { mood: "grateful", energy: "medium", weight: 0.5 },
  "thank you":    { mood: "grateful", energy: "medium", weight: 0.6 },
  "shukriya":     { mood: "grateful", energy: "medium", weight: 0.7 },
  "dhanyawad":    { mood: "grateful", energy: "medium", weight: 0.7 },
  "grateful":     { mood: "grateful", energy: "medium", weight: 0.8 },

  // ── Confused ────────────────────────────────────────────────────────────────
  "confused":     { mood: "confused", energy: "medium", weight: 0.7 },
  "samajh nahi":  { mood: "confused", energy: "medium", weight: 0.7 },
  "lost":         { mood: "confused", energy: "low", weight: 0.6 },
  "what":         { mood: "confused", energy: "medium", weight: 0.3 },

  // ── Motivated ───────────────────────────────────────────────────────────────
  "motivated":    { mood: "motivated", energy: "high", weight: 0.9 },
  "let's go":     { mood: "motivated", energy: "high", weight: 0.7 },
  "chalo":        { mood: "motivated", energy: "high", weight: 0.5 },
  "fired up":     { mood: "motivated", energy: "high", weight: 0.8 },
  "ready":        { mood: "motivated", energy: "high", weight: 0.5 },
  "productive":   { mood: "motivated", energy: "high", weight: 0.7 },
};

/**
 * Scan text for emotion keywords and return the best match.
 * Checks for multi-word phrases first, then single words.
 */
export function matchKeywords(text: string): KeywordMatch | null {
  const lower = text.toLowerCase();
  let bestMatch: KeywordMatch | null = null;
  let bestWeight = 0;
  let matchedPhrase = "";

  // Sort by phrase length (longer phrases first for specificity)
  const phrases = Object.keys(EMOTION_KEYWORDS).sort((a, b) => b.length - a.length);

  for (const phrase of phrases) {
    const idx = lower.indexOf(phrase);
    if (idx !== -1) {
      const match = EMOTION_KEYWORDS[phrase]!;
      if (match.weight > bestWeight) {
        bestMatch = match;
        bestWeight = match.weight;
        matchedPhrase = phrase;
      }
    }
  }

  // Simple negation detection – if a negation word appears shortly before the matched keyword,
  // we invert the sentiment and assign a high weight to override potential ML errors.
  if (bestMatch) {
    const phraseIdx = lower.indexOf(matchedPhrase);
    const textBefore = lower.substring(0, phraseIdx).trim();
    const negations = ["not", "never", "no", "don't", "didn't", "won't", "can't", "isn't", "aren't", "ain't"];
    
    const wordsBefore = textBefore.split(/\s+/);
    const lastWordBefore = wordsBefore[wordsBefore.length - 1];

    if (negations.includes(lastWordBefore) || textBefore.endsWith("n't")) {
      // Invert positive moods to negative
      if (["happy", "excited", "motivated", "grateful"].includes(bestMatch.mood)) {
        bestMatch = { ...bestMatch, mood: "sad", weight: 0.9 };
      } 
      // Invert negative moods to neutral/positive
      else if (["sad", "angry", "anxious", "frustrated", "stressed", "tired"].includes(bestMatch.mood)) {
        bestMatch = { ...bestMatch, mood: "neutral", energy: "medium", weight: 0.9 };
      }
    }
  }

  return bestMatch;
}
