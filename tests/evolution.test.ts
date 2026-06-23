// tests/evolution.test.ts
import { expect, test, describe, beforeAll } from "bun:test";
import { initDatabase } from "../src/memory/db";
import { updatePatterns, getPersonalityProfile, getBehaviorSummary } from "../src/memory/evolution";

describe("Personality Evolution Engine Tests", () => {
  beforeAll(() => {
    initDatabase();
  });

  test("Extract and update language preference to Hinglish", () => {
    updatePatterns("Acha bhai, can you please explain this code?");
    
    const profile = getPersonalityProfile();
    const lang = profile.find(p => p.patternName === "preferred_language");
    expect(lang).toBeDefined();
    expect(lang!.observations).toContain("Hinglish");
  });

  test("Extract response length preferences", () => {
    updatePatterns("Make it concise");

    const profile = getPersonalityProfile();
    const len = profile.find(p => p.patternName === "response_length");
    expect(len).toBeDefined();
    expect(len!.observations).toContain("concise");
  });

  test("Get behavior summary contains expected patterns", () => {
    const summary = getBehaviorSummary();
    expect(summary).toContain("Preferred preferred language");
    expect(summary).toContain("Preferred response length");
  });
});
