// src/web/instrumentation.ts
// Next.js instrumentation hook — runs once when the server starts.
// We use it to schedule Ollama warmup before the first request when possible.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // 1. Ollama Warmup (guarded globally)
    import("@llm/ollama.js")
      .then(({ startOllamaWarmup }) => startOllamaWarmup())
      .catch((err: unknown) => {
        console.warn("[instrumentation] Ollama warmup start failed:", err instanceof Error ? err.message : err);
      });

    // 2. Initialize Database and start Scheduler Engine in Web Server Runtime
    import("@memory/db.js")
      .then(({ initDatabase }) => {
        initDatabase();
        return import("@proactive/scheduler.js");
      })
      .then(({ startScheduler }) => {
        startScheduler();
        console.log("[instrumentation] Scheduler engine initialized in web server runtime");
      })
      .catch((err: unknown) => {
        console.warn("[instrumentation] Scheduler initialization failed:", err instanceof Error ? err.message : err);
      });
  }
}
