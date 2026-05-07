// ════════════════════════════════════════════════════════════════════════════════
// src/index.ts — Main entry point for Creater AI Assistant
// ════════════════════════════════════════════════════════════════════════════════
//
//   ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗██████╗ 
//  ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝██╔══██╗
//  ██║     ██████╔╝█████╗  ███████║   ██║   █████╗  ██████╔╝
//  ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝  ██╔══██╗
//  ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗██║  ██║
//   ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝
//
//  Your Personal AI Assistant — Local-first, proactive, emotionally intelligent.
//
// ════════════════════════════════════════════════════════════════════════════════

import { env, isDev } from "@config/index.js";
import { checkOllamaHealth, ensureModel } from "@llm/ollama.js";
import { Models } from "@config/models.js";
import { initVectorStore } from "@memory/vector.js";
import { startScheduler, stopScheduler } from "@proactive/scheduler.js";
import { startTelegramBot, stopTelegramBot } from "@bot/telegram.js";
import { startTUI } from "@tui/app.js";
import { setupGlobalErrorHandler } from "@utils/errorHandler.js";
import { log } from "@utils/logger.js";

// ─── Bootstrap Sequence ───────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const startTime = Date.now();

  // 1. Global error handlers
  setupGlobalErrorHandler();

  log.info("═══════════════════════════════════════════════════");
  log.info(`  ${env.APP_NAME} v0.1.0 — Starting up...`);
  log.info(`  Environment: ${env.APP_ENV}`);
  log.info(`  User: ${env.USER_NAME}`);
  log.info(`  Timezone: ${env.USER_TIMEZONE}`);
  log.info("═══════════════════════════════════════════════════");

  // 2. Check Ollama connectivity
  log.info("Checking Ollama connection...");
  const health = await checkOllamaHealth();
  if (!health.ok) {
    log.error("Ollama is not reachable!", health.error);
    log.error("Please start Ollama: `ollama serve` or `docker compose up -d`");
    process.exit(1);
  }
  const models = health.value;
  log.info(`Ollama connected — ${models.length} models available`);

  // 3. Ensure required models are pulled
  log.info("Ensuring required models are available...");
  try {
    await ensureModel(Models.FAST);
    await ensureModel(Models.PRIMARY);
    // Coder and embed models are optional — don't block startup
    ensureModel(Models.CODER).catch(() => log.warn("Coder model not available"));
    ensureModel(Models.EMBED).catch(() => log.warn("Embed model not available"));
  } catch (e) {
    log.error("Failed to ensure models", e);
    log.warn("Continuing with available models...");
  }

  // 4. Initialize vector store
  log.info("Initializing vector store...");
  initVectorStore();

  // 5. Start proactive scheduler
  startScheduler();

  // 6. Start Telegram bot (if enabled)
  startTelegramBot();

  // 7. Calculate startup time
  const elapsed = Date.now() - startTime;
  log.info(`✅ ${env.APP_NAME} ready in ${elapsed}ms`);

  // 8. Start TUI (this blocks — it's the main interaction loop)
  startTUI();

  // ── Graceful Shutdown ───────────────────────────────────────────────────────
  const shutdown = () => {
    log.info("Shutting down...");
    stopScheduler();
    stopTelegramBot();
    log.info("Goodbye! 👋");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ─── Run ──────────────────────────────────────────────────────────────────────────
main().catch((error) => {
  console.error("Fatal startup error:", error);
  process.exit(1);
});
