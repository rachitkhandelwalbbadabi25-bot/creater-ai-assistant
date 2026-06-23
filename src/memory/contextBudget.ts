// src/memory/contextBudget.ts — Context Budget Manager
// Prevent token explosion by ranking and trimming memory entries injected into prompt context.

export interface ScoredMemory {
  text: string;
  relevance: number; // 0.0 - 1.0
  importance: number; // 0.0 - 1.0
  recency: number; // 0.0 - 1.0
  confidence: number; // 0.0 - 1.0
  graphConnected: boolean;
}

export function estimateContextTokens(text: string): number {
  // Simple token estimator: 1 token ~ 4 characters
  return Math.ceil(text.length / 4);
}

export function rankMemories(memories: ScoredMemory[]): ScoredMemory[] {
  return memories
    .map(m => {
      // Priority weights: relevance (40%), importance (20%), recency (15%), confidence (15%), graph-connection (10%)
      const score =
        m.relevance * 0.4 +
        m.importance * 0.2 +
        m.recency * 0.15 +
        m.confidence * 0.15 +
        (m.graphConnected ? 0.1 : 0);
      return { ...m, finalScore: score };
    })
    .sort((a, b) => (b as any).finalScore - (a as any).finalScore);
}

export function selectTopMemories(memories: ScoredMemory[], maxTokens = 2048): ScoredMemory[] {
  const ranked = rankMemories(memories);
  const selected: ScoredMemory[] = [];
  let currentTokens = 0;

  for (const m of ranked) {
    const tokens = estimateContextTokens(m.text);
    if (currentTokens + tokens <= maxTokens) {
      selected.push(m);
      currentTokens += tokens;
    }
  }

  return selected;
}

export function trimContext(context: any, maxTokens = 4096): any {
  // Estimate tokens for the entire context payload
  const rawStr = JSON.stringify(context);
  let tokens = estimateContextTokens(rawStr);

  if (tokens <= maxTokens) {
    return context;
  }

  // Trim memories first (relevantMemories) all the way to 0 if needed
  if (context.relevantMemories && Array.isArray(context.relevantMemories)) {
    while (context.relevantMemories.length > 0 && tokens > maxTokens) {
      context.relevantMemories.pop();
      tokens = estimateContextTokens(JSON.stringify(context));
    }
  }

  // Trim user profile facts next all the way to 0 if needed
  if (context.userProfileFacts && Array.isArray(context.userProfileFacts) && tokens > maxTokens) {
    while (context.userProfileFacts.length > 0 && tokens > maxTokens) {
      context.userProfileFacts.pop();
      tokens = estimateContextTokens(JSON.stringify(context));
    }
  }

  // Trim recent messages last if still too large
  if (context.recentMessages && Array.isArray(context.recentMessages) && tokens > maxTokens) {
    while (context.recentMessages.length > 0 && tokens > maxTokens) {
      context.recentMessages.pop();
      tokens = estimateContextTokens(JSON.stringify(context));
    }
  }

  return context;
}
