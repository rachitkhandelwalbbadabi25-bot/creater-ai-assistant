// tests/memoryHealth.test.ts
import { expect, test, describe, beforeAll } from "bun:test";
import { initDatabase } from "../src/memory/db";
import { getMemoryStats, detectDuplicateMemories, detectGraphExplosion, detectOversizedContext, detectUnusedNodes, generateHealthReport } from "../src/memory/memoryHealth";

describe("Memory Health Monitor Tests", () => {
  beforeAll(() => {
    initDatabase();
  });

  test("Retrieve memory statistics", () => {
    const stats = getMemoryStats();
    expect(stats.facts).toBeDefined();
    expect(stats.timeline).toBeDefined();
    expect(stats.nodes).toBeDefined();
    expect(stats.edges).toBeDefined();
  });

  test("Graph explosion detection", () => {
    const explosion = detectGraphExplosion();
    expect(typeof explosion).toBe("boolean");
  });

  test("Oversized context checker", () => {
    expect(detectOversizedContext(9000)).toBe(true);
    expect(detectOversizedContext(5000)).toBe(false);
  });

  test("Unused nodes counts", () => {
    const unused = detectUnusedNodes();
    expect(unused).toBeDefined();
  });

  test("Generate full health report", () => {
    const report = generateHealthReport(80); // 80ms average latency
    expect(report.status).toBe("healthy");
    expect(report.avgRetrievalMs).toBe(80);
    expect(report.cacheHitRatio).toBeDefined();
  });
});
