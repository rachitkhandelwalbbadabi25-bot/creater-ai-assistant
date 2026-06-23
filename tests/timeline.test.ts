// tests/timeline.test.ts
import { expect, test, describe, beforeAll } from "bun:test";
import { initDatabase } from "../src/memory/db";
import { recordEvent, getTimeline, getMonthlySummary, getYearlySummary, autoDetectTimelineEvents } from "../src/memory/timeline";

describe("Timeline Engine Tests", () => {
  beforeAll(() => {
    initDatabase();
  });

  test("Record and retrieve timeline event", () => {
    const event = recordEvent(
      "achievement",
      "Won Startup Competition",
      "Selected as number one in the state",
      0.9,
      1.0,
      ["startup", "first-place"]
    );

    expect(event.id).toBeDefined();
    expect(event.title).toBe("Won Startup Competition");

    const timeline = getTimeline({ category: "achievement" });
    const found = timeline.find(e => e.id === event.id);
    expect(found).toBeDefined();
    expect(found!.title).toBe("Won Startup Competition");
  });

  test("Monthly and Yearly summaries generation", () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = date.getMonth() + 1;

    recordEvent("project", "Started Living Memory Phase 5", "Core memory graph system", 0.8);

    const monthly = getMonthlySummary(year, month);
    expect(monthly).toContain("Started Living Memory Phase 5");

    const yearly = getYearlySummary(year);
    expect(yearly).toContain("Started Living Memory Phase 5");
  });

  test("Auto-detect milestone events from message content", async () => {
    const text = "I just got selected in startup competition!";
    await autoDetectTimelineEvents(text);

    const timeline = getTimeline({ category: "achievement" });
    const found = timeline.find(e => e.description === text);
    expect(found).toBeDefined();
    expect(found!.title).toBe("I just got selected in startup competition!");
  });
});
