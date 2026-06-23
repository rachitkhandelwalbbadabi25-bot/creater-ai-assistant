import { getRecentMessages } from "./shortTerm.js";
import { searchSummaries } from "./midTerm.js";
import { searchFacts, getAllFacts } from "./longTerm.js";
import { buildGraphContext, searchGraph } from "./graph.js";
import { createLogger } from "@utils/logger.js";
import type { MemoryContext } from "@utils/contextBuilder.js";
import { IS_RUNTIME_DEBUG, logPerf, nowMs } from "@utils/perf.js";
import { getCached, setCached } from "./cache.js";
import { trimContext } from "./contextBudget.js";

// Maximum number of facts to inject into context per request.
// Keeps payloadChars well under budget.
const MAX_FACTS_IN_CONTEXT = 10;

const log = createLogger("memory/retriever");

export interface RetrievalOptions {
  query: string;
  recentMessageCount?: number;
  semanticResultCount?: number;
  includeProfile?: boolean;
  includeTasks?: boolean;
  skipSemanticSearch?: boolean;
}

const EXECUTION_SKIP_PATTERN = /\b(open|launch|start|run|search|google|youtube|browser|url|download|screenshot|capture screen)\b/i;
const SYSTEM_STATUS_PATTERN = /\b(system|laptop|battery)\b/i;

export async function retrieveContext(options: RetrievalOptions): Promise<MemoryContext> {
  const cacheKey = `retrieval:${options.query}:${options.recentMessageCount ?? 10}:${options.semanticResultCount ?? 5}`;
  const cached = getCached<MemoryContext>("retrieval", cacheKey);
  if (cached) {
    if (IS_RUNTIME_DEBUG) {
      log.info("Retrieval cache hit", { query: options.query });
    }
    return cached;
  }

  console.time('retrieveContext');
  const result = await actualRetrieveContext(options);
  const trimmed = trimContext(result);
  setCached("retrieval", cacheKey, trimmed);
  console.timeEnd('retrieveContext');
  return trimmed;
}

async function actualRetrieveContext(options: RetrievalOptions): Promise<MemoryContext> {
  const startedAt = nowMs();
  const {
    query,
    recentMessageCount = 10,
    semanticResultCount = 5,
    includeProfile = true,
    skipSemanticSearch = false,
  } = options;

  log.mem(`Retrieving context for: "${query.slice(0, 80)}"`);

  const recentMessages = getRecentMessages(recentMessageCount)
    .reverse()
    .map((m) => `${m.role === "user" ? "User" : "Creater"}: ${m.content}`);

  let relevantMemories: string[] = [];
  const shouldSkipSemanticSearch = skipSemanticSearch || EXECUTION_SKIP_PATTERN.test(query);

  if (!shouldSkipSemanticSearch) {
    try {
      const { search: vectorSearch } = await import("./vector.js");
      const vectorResults = await vectorSearch(query, semanticResultCount, 0.35);
      relevantMemories = vectorResults.map((r) => `[${(r.score * 100).toFixed(0)}% match] ${r.entry.text}`);
    } catch (e) {
      log.warn("Vector search failed - continuing without semantic results", {
        error: String(e),
      });
    }
  } else if (IS_RUNTIME_DEBUG) {
    log.info("Semantic retrieval skipped", { query });
    log.info("EMBEDDING BYPASS ACTIVE", { query });
  }

  const keywords = extractKeywords(query);
  if (keywords.length > 0) {
    const summaryResults = searchSummaries(keywords[0]!, 3);
    for (const summary of summaryResults) {
      relevantMemories.push(`[summary] ${summary.content}`);
    }
  }

  if (includeProfile) {
    const factResults = searchFacts(query, 5);
    for (const fact of factResults) {
      relevantMemories.push(`[fact:${fact.category}] ${fact.key}: ${fact.value}`);
    }
  }

  const entities = extractEntities(query);
  const graphNodes = searchGraph(query, 5);
  for (const entity of entities) {
    const entityResults = searchGraph(entity, 3);
    for (const node of entityResults) {
      if (!graphNodes.find((existing) => existing.id === node.id)) {
        graphNodes.push(node);
      }
    }
  }

  for (const node of graphNodes.sort((a, b) => b.importance - a.importance).slice(0, 8)) {
    relevantMemories.push(`[graph:${node.type}] ${node.label}${node.description ? `: ${node.description}` : ""}`);
  }

  let systemStatus: any;
  const isExplicitSystemQuery = /\b(status|info|metrics|usage|percent|charging|specs|specification|temp|temperature|uptime)\b/i.test(query);
  if (SYSTEM_STATUS_PATTERN.test(query) && isExplicitSystemQuery) {
    try {
      const { getSystemInfo } = await import("@tools/laptop/system.js");
      systemStatus = await getSystemInfo();
    } catch {
      log.warn("Failed to fetch system info for context");
    }
  }

  // ─── Fact injection — capped to prevent context bloat ───────────────────────
  // getAllFacts() can return hundreds of rows; we cap at MAX_FACTS_IN_CONTEXT.
  // On first boot (no facts) this is effectively free.
  const allFacts = getAllFacts();
  const cappedFacts = allFacts.slice(0, MAX_FACTS_IN_CONTEXT);

  // Graph context is expensive and verbose — only include in debug mode.
  const graphCtx = IS_RUNTIME_DEBUG ? buildGraphContext(5) : undefined;

  const context: MemoryContext = {
    recentMessages,
    relevantMemories,
    activeProjects: [],
    pendingTasks: [],
    upcomingDeadlines: [],
    systemStatus,
    userProfileFacts: cappedFacts,
    graphContext: graphCtx,
  };

  // ─── Context size audit ──────────────────────────────────────────────────────
  const payloadChars = JSON.stringify(context).length;
  console.log("[CONTEXT_AUDIT]", {
    messageCount: recentMessages.length,
    relevantMemories: relevantMemories.length,
    factsTotal: allFacts.length,
    factsCapped: cappedFacts.length,
    payloadChars,
    payloadBudgetOk: payloadChars < 8000,
  });
  if (payloadChars >= 8000) {
    log.warn("[CONTEXT_BLOAT] payloadChars exceeds 8000 — consider pruning memory sources", { payloadChars });
  }

  log.mem(`Retrieved context: ${recentMessages.length} recent, ${relevantMemories.length} relevant, ${cappedFacts.length} facts`);
  logPerf(log, "retrieveContext completed", startedAt, {
    skipSemanticSearch: shouldSkipSemanticSearch,
    relevantMemories: relevantMemories.length,
    payloadChars,
  });
  return context;
}

export function retrieveQuickContext(messageCount = 5): MemoryContext {
  const recent = getRecentMessages(messageCount);
  return {
    recentMessages: recent.reverse().map((m) => `${m.role}: ${m.content}`),
    relevantMemories: [],
  };
}

function extractEntities(text: string): string[] {
  const capitalized = text.match(/[A-Z][a-z]+/g) || [];
  const keywords = extractKeywords(text);
  return [...new Set([...capitalized, ...keywords])];
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "in", "on", "at", "to",
    "for", "of", "with", "and", "or", "but", "not", "this", "that", "it",
    "i", "me", "my", "you", "your", "we", "our", "he", "she", "they",
    "do", "did", "does", "have", "has", "had", "will", "would", "can",
    "could", "should", "may", "might", "what", "how", "when", "where",
    "why", "who", "which", "kya", "kaise", "kab", "kyun", "kahan",
    "hai", "hain", "tha", "thi", "ho", "kar", "mein", "ko", "se", "ka",
  ]);

  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));
}
