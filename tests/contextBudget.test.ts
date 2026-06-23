// tests/contextBudget.test.ts
import { expect, test, describe } from "bun:test";
import { estimateContextTokens, rankMemories, selectTopMemories, trimContext, ScoredMemory } from "../src/memory/contextBudget";

describe("Context Budget Manager Tests", () => {
  test("Token estimation matches length heuristics", () => {
    expect(estimateContextTokens("hello")).toBe(2); // 5 chars / 4 = 1.25 -> 2
    expect(estimateContextTokens("a".repeat(100))).toBe(25);
  });

  test("Rank memories priorities", () => {
    const memories: ScoredMemory[] = [
      { text: "Low relevance", relevance: 0.1, importance: 0.1, recency: 0.1, confidence: 0.5, graphConnected: false },
      { text: "High relevance", relevance: 0.9, importance: 0.8, recency: 0.8, confidence: 0.9, graphConnected: true }
    ];

    const ranked = rankMemories(memories);
    expect(ranked[0]!.text).toBe("High relevance");
  });

  test("Select top memories does not exceed max tokens limit", () => {
    const memories: ScoredMemory[] = [
      { text: "A".repeat(400), relevance: 0.9, importance: 0.8, recency: 0.8, confidence: 0.9, graphConnected: true }, // ~100 tokens
      { text: "B".repeat(400), relevance: 0.8, importance: 0.7, recency: 0.7, confidence: 0.8, graphConnected: true }  // ~100 tokens
    ];

    const selected = selectTopMemories(memories, 150);
    expect(selected.length).toBe(1); // Second memory omitted as total would exceed 150 tokens
  });

  test("Trim context payload to fit budget limit", () => {
    const context = {
      recentMessages: ["User: Hi", "Creater: Hello"],
      relevantMemories: ["Mem A".repeat(1000), "Mem B".repeat(1000)], // very large
      userProfileFacts: ["Fact A", "Fact B"]
    };

    const trimmed = trimContext(context, 500); // Trim context to fit under 500 tokens
    expect(estimateContextTokens(JSON.stringify(trimmed))).toBeLessThanOrEqual(500);
  });
});
