// tests/memoryReliability.test.ts
import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { addEntry, search, getMemoryMetrics, initVectorStore } from "../src/memory/vector.ts";
import { ollamaClient } from "../src/llm/ollama.ts";

describe("Memory & Embedding Reliability Layer Tests", () => {
  let originalEmbed: any;
  let originalList: any;

  beforeAll(() => {
    initVectorStore();
    originalEmbed = ollamaClient.embed;
    originalList = ollamaClient.list;
    // Mock list to avoid offline errors from listOllamaModels()
    ollamaClient.list = async () => {
      return { models: [{ name: "nomic-embed-text:latest" }, { name: "nomic-embed-text" }] } as any;
    };
  });

  afterAll(() => {
    ollamaClient.embed = originalEmbed;
    ollamaClient.list = originalList;
  });

  test("Ollama unavailable (throws network error) - fallback empty vector used, no crash", async () => {
    ollamaClient.embed = async () => {
      throw new Error("fetch failed (network error)");
    };

    const entry = await addEntry("Test content for unavailable Ollama", { test: true });
    expect(entry).not.toBeNull();
    expect(entry.vector.every(v => v === 0)).toBe(true);

    const metrics = getMemoryMetrics();
    expect(metrics.failedEmbeddings).toBeGreaterThan(0);
  }, 15000); // Set timeout to 15s to allow for nested retries

  test("Ollama timeout - triggers timeout recovery", async () => {
    ollamaClient.embed = async () => {
      throw new Error("Tool execution timeout after 30000ms");
    };

    const entry = await addEntry("Test timeout content", { test: true });
    expect(entry).not.toBeNull();
    expect(entry.vector.every(v => v === 0)).toBe(true);

    const metrics = getMemoryMetrics();
    expect(metrics.timeoutCount).toBeGreaterThan(0);
  }, 15000); // Set timeout to 15s to allow for nested retries

  test("Retry success on second attempt", async () => {
    let callCount = 0;
    ollamaClient.embed = async () => {
      callCount++;
      // inner withRetry has 2 attempts. First two calls fail to trigger executeTool retry.
      if (callCount <= 2) {
        throw new Error("Temporary network timeout");
      }
      return {
        model: "test",
        embeddings: [new Array(768).fill(1)],
        total_duration: 0,
        load_duration: 0,
        prompt_eval_count: 1,
      } as any;
    };

    const prevMetrics = getMemoryMetrics();
    const entry = await addEntry("Retry content", { test: true });
    expect(entry).not.toBeNull();
    expect(entry.vector.every(v => v === 1)).toBe(true);

    const metrics = getMemoryMetrics();
    expect(metrics.retryCount).toBe(prevMetrics.retryCount + 1);
  }, 15000);

  test("Vector search failure handling", async () => {
    ollamaClient.embed = async () => {
      throw new Error("Search embedding failed");
    };

    const results = await search("query description", 5, 0.3);
    expect(results).toEqual([]); // returns empty search result, no crash
  }, 15000);
});
