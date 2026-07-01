// src/monitoring/ollamaMetrics.ts

export interface OllamaMetricsSnapshot {
  load_ms: number;
  prompt_eval_ms: number;
  eval_ms: number;
  first_token_ms: number;
  total_ms: number;
  tokenPerSecond: number;
  activeOperations: number;
  queueWaitMs: number;
  totalOperations: number;
}

class OllamaMetricsTracker {
  private load_ms = 0;
  private prompt_eval_ms = 0;
  private eval_ms = 0;
  private first_token_ms = 0;
  private total_ms = 0;
  private totalTokens = 0;
  private totalEvalMs = 0;
  private activeOperations = 0;
  private queueWaitMs = 0;
  private totalOperations = 0;

  recordOperationStart(): void {
    this.activeOperations++;
    this.totalOperations++;
  }

  recordOperationEnd(): void {
    this.activeOperations = Math.max(0, this.activeOperations - 1);
  }

  recordQueueWait(ms: number): void {
    this.queueWaitMs += ms;
  }

  recordMetrics(data: {
    loadMs?: number;
    promptEvalMs?: number;
    evalMs?: number;
    firstTokenMs?: number;
    totalMs?: number;
    tokensProcessed?: number;
  }): void {
    if (data.loadMs !== undefined) this.load_ms += data.loadMs;
    if (data.promptEvalMs !== undefined) this.prompt_eval_ms += data.promptEvalMs;
    if (data.evalMs !== undefined) {
      this.eval_ms += data.evalMs;
      this.totalEvalMs += data.evalMs;
    }
    if (data.firstTokenMs !== undefined) this.first_token_ms += data.firstTokenMs;
    if (data.totalMs !== undefined) this.total_ms += data.totalMs;
    if (data.tokensProcessed !== undefined) this.totalTokens += data.tokensProcessed;
  }

  reset(): void {
    this.load_ms = 0;
    this.prompt_eval_ms = 0;
    this.eval_ms = 0;
    this.first_token_ms = 0;
    this.total_ms = 0;
    this.totalTokens = 0;
    this.totalEvalMs = 0;
    this.activeOperations = 0;
    this.queueWaitMs = 0;
    this.totalOperations = 0;
  }

  getSnapshot(): OllamaMetricsSnapshot {
    const tokenPerSecond = this.totalEvalMs > 0 ? (this.totalTokens / (this.totalEvalMs / 1000)) : 0;
    return {
      load_ms: this.load_ms,
      prompt_eval_ms: this.prompt_eval_ms,
      eval_ms: this.eval_ms,
      first_token_ms: this.first_token_ms,
      total_ms: this.total_ms,
      tokenPerSecond: Math.round(tokenPerSecond * 100) / 100,
      activeOperations: this.activeOperations,
      queueWaitMs: this.queueWaitMs,
      totalOperations: this.totalOperations,
    };
  }
}

export const ollamaMetricsTracker = new OllamaMetricsTracker();

export function getOllamaMetrics(): OllamaMetricsSnapshot {
  return ollamaMetricsTracker.getSnapshot();
}

export function resetOllamaMetrics(): void {
  ollamaMetricsTracker.reset();
}
