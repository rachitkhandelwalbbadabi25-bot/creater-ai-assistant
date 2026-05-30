// ════════════════════════════════════════════════════════════════════════════════
// src/memory/vector.ts — Local vector store for semantic memory (embeddings)
// ════════════════════════════════════════════════════════════════════════════════

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import { env } from "@config/index.js";
import { embedSingle, embed } from "@llm/ollama.js";
import { createLogger } from "@utils/logger.js";
import { generateId } from "@utils/helpers.js";

const log = createLogger("memory/vector");

const embeddingQueue: Array<{
  text: string;
  metadata: Record<string, unknown>;
  resolve?: (value: VectorEntry) => void;
  reject?: (reason: any) => void;
}> = [];
let isProcessingQueue = false;

// ─── Types ────────────────────────────────────────────────────────────────────────
export interface VectorEntry {
  id: string;
  text: string;
  vector: number[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface SearchResult {
  entry: VectorEntry;
  score: number; // cosine similarity 0..1
}

// ─── In-Memory Vector Store ───────────────────────────────────────────────────────
// Uses a flat file + in-memory array for simplicity (no external DB needed).
// Scales well up to ~50k entries for a personal assistant.

let entries: VectorEntry[] = [];
const STORE_PATH = join(env.VECTOR_DB_PATH, "vectors.json");

/**
 * Initialize vector store — load from disk if exists.
 */
export function initVectorStore(): void {
  const dir = env.VECTOR_DB_PATH;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    log.info(`Created vector store directory: ${dir}`);
  }

  if (existsSync(STORE_PATH)) {
    try {
      const raw = readFileSync(STORE_PATH, "utf-8");
      entries = JSON.parse(raw) as VectorEntry[];
      log.info(`Loaded ${entries.length} vectors from disk`);
    } catch (e) {
      log.warn("Failed to load vector store — starting fresh", { error: String(e) });
      entries = [];
    }
  }
}

/**
 * Persist current vector store to disk.
 */
export function saveVectorStore(): void {
  writeFileSync(STORE_PATH, JSON.stringify(entries), "utf-8");
  log.mem(`Saved ${entries.length} vectors to disk`);
}

export async function saveVectorStoreAsync(): Promise<void> {
  try {
    await writeFile(STORE_PATH, JSON.stringify(entries), "utf-8");
    log.mem(`Saved ${entries.length} vectors to disk asynchronously`);
  } catch (err) {
    log.error("Failed to save vector store asynchronously", err);
  }
}

async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (embeddingQueue.length > 0) {
    const item = embeddingQueue.shift();
    if (!item) continue;

    console.log("BACKGROUND EMBEDDING STARTED");
    try {
      let vector: number[];
      try {
        vector = await embedSingle(item.text);
      } catch (e) {
        log.warn("Failed to generate embedding for vector entry — using fallback empty vector", { error: String(e) });
        vector = new Array(768).fill(0);
      }

      const entry: VectorEntry = {
        id: generateId(),
        text: item.text,
        vector,
        metadata: item.metadata,
        createdAt: new Date().toISOString(),
      };

      entries.push(entry);
      log.mem(`Added vector entry`, { id: entry.id, textLen: item.text.length });

      if (entries.length % 10 === 0) {
        await saveVectorStoreAsync();
      }

      console.log("BACKGROUND EMBEDDING COMPLETE");
      if (item.resolve) {
        item.resolve(entry);
      }
    } catch (err) {
      console.log("BACKGROUND EMBEDDING FAILED");
      log.error("Background embedding failed", err);
      if (item.reject) {
        item.reject(err);
      }
    }
  }

  isProcessingQueue = false;
}

// ─── Core Operations ──────────────────────────────────────────────────────────────

/**
 * Add a text entry to the vector store (generates embedding via Ollama).
 */
export async function addEntry(
  text: string,
  metadata: Record<string, unknown> = {}
): Promise<VectorEntry> {
  console.log("BACKGROUND EMBEDDING QUEUED");
  const promise = new Promise<VectorEntry>((resolve, reject) => {
    embeddingQueue.push({ text, metadata, resolve, reject });
  });

  setTimeout(() => {
    processQueue().catch((err) => {
      console.log("BACKGROUND EMBEDDING FAILED");
    });
  }, 0);

  return promise;
}

/**
 * Batch-add multiple texts at once (more efficient — single embed call).
 */
export async function addEntries(
  items: Array<{ text: string; metadata?: Record<string, unknown> }>
): Promise<VectorEntry[]> {
  const promises = items.map((item) => {
    console.log("BACKGROUND EMBEDDING QUEUED");
    return new Promise<VectorEntry>((resolve, reject) => {
      embeddingQueue.push({ text: item.text, metadata: item.metadata ?? {}, resolve, reject });
    });
  });

  setTimeout(() => {
    processQueue().catch((err) => {
      console.log("BACKGROUND EMBEDDING FAILED");
    });
  }, 0);

  return Promise.all(promises);
}

/**
 * Semantic search — find the most similar entries to a query.
 */
export async function search(
  query: string,
  topK = 5,
  minScore = 0.3
): Promise<SearchResult[]> {
  if (entries.length === 0) return [];

  let queryVector: number[];
  try {
    queryVector = await embedSingle(query);
  } catch (e) {
    log.warn("Failed to generate embedding for search query — returning empty results", { error: String(e) });
    return [];
  }

  const scored: SearchResult[] = entries
    .map((entry) => ({
      entry,
      score: cosineSimilarity(queryVector, entry.vector),
    }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  log.mem(`Vector search: "${query.slice(0, 60)}" → ${scored.length} results`);
  return scored;
}

/**
 * Delete an entry by ID.
 */
export function deleteEntry(id: string): boolean {
  const before = entries.length;
  entries = entries.filter((e) => e.id !== id);
  if (entries.length < before) {
    saveVectorStore();
    return true;
  }
  return false;
}

/**
 * Get total entry count.
 */
export function getEntryCount(): number {
  return entries.length;
}

// ─── Math ─────────────────────────────────────────────────────────────────────────
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
