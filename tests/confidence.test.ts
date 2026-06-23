// tests/confidence.test.ts
import { expect, test, describe, beforeAll } from "bun:test";
import { initDatabase, getDB } from "../src/memory/db";
import { calculateConfidence, updateConfidence, decayConfidence, validateMemory } from "../src/memory/confidence";
import { recordEvent, getTimeline } from "../src/memory/timeline";

describe("Confidence & Trust Scoring Tests", () => {
  beforeAll(() => {
    initDatabase();
  });

  test("Calculate confidence based on source", () => {
    expect(calculateConfidence("user_explicit", "preference")).toBe(1.0);
    expect(calculateConfidence("auto-detected", "milestone")).toBe(0.7);
    expect(calculateConfidence("inferred", "inferred")).toBe(0.4);
  });

  test("Update, decay and validate event confidence", () => {
    const event = recordEvent("achievement", "Completed BBA-DABI", "Details", 0.9, 0.8);
    expect(event.confidence).toBe(0.8);

    updateConfidence("timeline_events", event.id, 0.95);
    let timeline = getTimeline({ category: "achievement" });
    let found = timeline.find(e => e.id === event.id);
    expect(found!.confidence).toBe(0.95);

    decayConfidence("timeline_events", 0.9);
    timeline = getTimeline({ category: "achievement" });
    found = timeline.find(e => e.id === event.id);
    expect(found!.confidence).toBeCloseTo(0.855, 3);

    validateMemory("timeline_events", event.id);
    timeline = getTimeline({ category: "achievement" });
    found = timeline.find(e => e.id === event.id);
    expect(found!.confidence).toBe(1.0);
  });
});
