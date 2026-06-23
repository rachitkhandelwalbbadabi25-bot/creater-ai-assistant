// src/web/instrumentation.ts
// Next.js instrumentation hook — runs once when the server starts.
// We use it to schedule Ollama warmup before the first request when possible.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Uses the @llm alias configured in next.config.mjs -> ../../src/llm.
    // Warmup is guarded globally and never uses the app-level Ollama mutex.
    import("@llm/ollama.js")
      .then(({ startOllamaWarmup }) => startOllamaWarmup())
      .catch((err: unknown) => {
        console.warn("[instrumentation] Ollama warmup start failed:", err instanceof Error ? err.message : err);
      });
  }
}
