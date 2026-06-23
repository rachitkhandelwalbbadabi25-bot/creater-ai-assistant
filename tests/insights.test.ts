// tests/insights.test.ts
import { expect, test, describe, beforeAll } from "bun:test";
import { initDatabase } from "../src/memory/db";
import { generateInsights, getTopInsights, validateInsight } from "../src/memory/insights";
import { updatePatterns } from "../src/memory/evolution";

describe("Insight Engine Tests", () => {
  beforeAll(() => {
    initDatabase();
  });

  test("Generate insights from personality patterns", () => {
    // Inject personality pattern observations to trigger insights
    updatePatterns("Let's build an LLM project", new Date().toISOString());
    updatePatterns("Acha bro, give me brief details", "2026-06-22T23:30:00.000Z"); // late night (23:30)

    const count = generateInsights();
    expect(count).toBeGreaterThan(0);

    const insights = getTopInsights();
    expect(insights.length).toBeGreaterThan(0);
    expect(insights.some(i => i.insight.includes("works late"))).toBe(true);
  });

  test("Validate and update confidence of insight", () => {
    const insights = getTopInsights();
    const target = insights[0]!;
    
    const ok = validateInsight(target.id, 0.99);
    expect(ok).toBe(true);

    const updated = getTopInsights();
    const found = updated.find(i => i.id === target.id);
    expect(found!.confidence).toBe(0.99);
  });
});
