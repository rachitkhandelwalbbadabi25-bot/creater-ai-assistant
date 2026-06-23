// src/memory/cache.ts — Memory Cache Layer
// LRU Cache with TTL support to prevent repeated database, graph, and vector lookups.

export interface CacheOptions {
  ttlMs?: number;
  maxSize?: number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  accessSeq: number;
}

export class MemoryCache {
  private cache = new Map<string, CacheEntry<any>>();
  private defaultTtlMs: number;
  private maxSize: number;
  private accessCounter = 0;
  private hits = 0;
  private misses = 0;

  constructor(options: CacheOptions = {}) {
    this.defaultTtlMs = options.ttlMs ?? 60000;
    this.maxSize = options.maxSize ?? 1000;
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    const ttl = ttlMs ?? this.defaultTtlMs;
    const expiresAt = Date.now() + ttl;

    if (this.cache.size >= this.maxSize) {
      let oldestKey: string | null = null;
      let oldestSeq = Infinity;
      for (const [k, entry] of this.cache.entries()) {
        if (entry.accessSeq < oldestSeq) {
          oldestSeq = entry.accessSeq;
          oldestKey = k;
        }
      }
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      value,
      expiresAt,
      accessSeq: ++this.accessCounter
    });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    entry.accessSeq = ++this.accessCounter;
    this.hits++;
    return entry.value as T;
  }

  invalidate(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats() {
    const total = this.hits + this.misses;
    const hitRatio = total === 0 ? 0 : this.hits / total;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRatio
    };
  }
}

// Global cache instances for different memory layers
export const retrievalCache = new MemoryCache({ ttlMs: 30000 });
export const graphCache = new MemoryCache({ ttlMs: 30000 });
export const timelineCache = new MemoryCache({ ttlMs: 60000 });
export const knowledgeCache = new MemoryCache({ ttlMs: 60000 });
export const insightsCache = new MemoryCache({ ttlMs: 60000 });

export function getCached<T>(cacheType: "retrieval" | "graph" | "timeline" | "knowledge" | "insights", key: string): T | null {
  switch (cacheType) {
    case "retrieval": return retrievalCache.get<T>(key);
    case "graph": return graphCache.get<T>(key);
    case "timeline": return timelineCache.get<T>(key);
    case "knowledge": return knowledgeCache.get<T>(key);
    case "insights": return insightsCache.get<T>(key);
  }
}

export function setCached<T>(cacheType: "retrieval" | "graph" | "timeline" | "knowledge" | "insights", key: string, value: T, ttlMs?: number): void {
  switch (cacheType) {
    case "retrieval": retrievalCache.set(key, value, ttlMs); break;
    case "graph": graphCache.set(key, value, ttlMs); break;
    case "timeline": timelineCache.set(key, value, ttlMs); break;
    case "knowledge": knowledgeCache.set(key, value, ttlMs); break;
    case "insights": insightsCache.set(key, value, ttlMs); break;
  }
}

export function invalidateCache(cacheType: "retrieval" | "graph" | "timeline" | "knowledge" | "insights", key?: string): void {
  if (key) {
    switch (cacheType) {
      case "retrieval": retrievalCache.invalidate(key); break;
      case "graph": graphCache.invalidate(key); break;
      case "timeline": timelineCache.invalidate(key); break;
      case "knowledge": knowledgeCache.invalidate(key); break;
      case "insights": insightsCache.invalidate(key); break;
    }
  } else {
    // Clear entire sub-cache on write
    switch (cacheType) {
      case "retrieval": retrievalCache.clear(); break;
      case "graph": graphCache.clear(); break;
      case "timeline": timelineCache.clear(); break;
      case "knowledge": knowledgeCache.clear(); break;
      case "insights": insightsCache.clear(); break;
    }
  }
}

export function clearCache(): void {
  retrievalCache.clear();
  graphCache.clear();
  timelineCache.clear();
  knowledgeCache.clear();
  insightsCache.clear();
}

export function getCacheStats() {
  return {
    retrieval: retrievalCache.getStats(),
    graph: graphCache.getStats(),
    timeline: timelineCache.getStats(),
    knowledge: knowledgeCache.getStats(),
    insights: insightsCache.getStats()
  };
}
