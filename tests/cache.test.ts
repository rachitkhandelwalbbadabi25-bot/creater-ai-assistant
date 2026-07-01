// tests/cache.test.ts
import { expect, test, describe, beforeAll } from "bun:test";
import { MemoryCache, getCached, setCached, invalidateCache, clearCache, getCacheStats } from "../src/memory/cache.ts";

describe("Memory Cache Layer Tests", () => {
  beforeAll(() => {
    clearCache();
  });

  test("Cache Set and Get works correctly", () => {
    setCached("retrieval", "test-key", { data: "test-value" });
    const cached = getCached<any>("retrieval", "test-key");
    expect(cached).not.toBeNull();
    expect(cached.data).toBe("test-value");
  });

  test("Cache TTL expiration works", async () => {
    const tempCache = new MemoryCache({ ttlMs: 10 });
    tempCache.set("temp-key", "val");
    expect(tempCache.get("temp-key") as any).toEqual("val");

    // Wait for TTL expiration
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(tempCache.get("temp-key")).toBeNull();
  });

  test("Cache Eviction (LRU) triggers when max size exceeded", () => {
    const tinyCache = new MemoryCache({ maxSize: 2 });
    tinyCache.set("k1", "v1");
    tinyCache.set("k2", "v2");
    
    // Access k1 to make k2 the oldest accessed
    tinyCache.get("k1");
    
    tinyCache.set("k3", "v3");
    expect(tinyCache.get("k1") as any).toEqual("v1");
    expect(tinyCache.get("k2")).toBeNull(); // evicted
    expect(tinyCache.get("k3") as any).toEqual("v3");
  });

  test("Cache Invalidation works", () => {
    setCached("graph", "graph-key", "graph-value");
    expect(getCached("graph", "graph-key") as any).toEqual("graph-value");
    
    invalidateCache("graph", "graph-key");
    expect(getCached("graph", "graph-key")).toBeNull();
  });

  test("Cache Stats returns accurate counts", () => {
    clearCache();
    getCached("insights", "missing-key"); // Miss
    setCached("insights", "present-key", "value");
    getCached("insights", "present-key"); // Hit

    const stats = getCacheStats();
    expect(stats.insights.hits).toBe(1);
    expect(stats.insights.misses).toBe(1);
    expect(stats.insights.hitRatio).toBe(0.5);
  });
});
