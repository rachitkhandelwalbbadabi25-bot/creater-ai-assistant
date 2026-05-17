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
import { loadPersistedSettings } from "@config/settings.js";
import { checkOllamaHealth, ensureModel } from "@llm/ollama.js";
import { Models, isLocalModel } from "@config/models.js";
import { initVectorStore } from "@memory/vector.js";
import { startScheduler, stopScheduler } from "@proactive/scheduler.js";
import { startTelegramBot, stopTelegramBot } from "@bot/telegram.js";
import { startTUI } from "@tui/app.js";
import { startWakeWordDetection, stopWakeWordDetection } from "@voice/wakeWord.js";
import { setupGlobalErrorHandler } from "@utils/errorHandler.js";
import { log } from "@utils/logger.js";
import { preloadModel as preloadEmotionModel } from "@emotion/xenova.js";
import { initSTT as preloadWhisperModel } from "@voice/stt.js";

// ─── Bootstrap Sequence ───────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const startTime = Date.now();

  // 1. Global error handlers
  setupGlobalErrorHandler();

  // 1b. Load persistent settings from database
  loadPersistedSettings();

  log.info("═══════════════════════════════════════════════════");
  log.info(`  ${env.APP_NAME} v0.1.0 — Starting up...`);
  log.info(`  Environment: ${env.APP_ENV}`);
  log.info(`  User: ${env.USER_NAME}`);
  log.info(`  Timezone: ${env.USER_TIMEZONE}`);
  
  const primaryModel = env.DEFAULT_MODEL || Models.PRIMARY;
  const isLocal = isLocalModel(primaryModel) && env.LLM_PROVIDER !== "cloud";
  log.info(`  Active Model: ${primaryModel} [${isLocal ? "LOCAL" : "CLOUD"}]`);
  log.info("═══════════════════════════════════════════════════");

  // 2. LLM Readiness Check
  if (isLocal) {
    log.info("Checking Ollama connection...");
    const health = await checkOllamaHealth();
    if (!health.ok) {
      const hasCloudKey = !!(
        env.ANTHROPIC_API_KEY ||
        env.OPENAI_API_KEY ||
        env.DEEPSEEK_API_KEY ||
        env.GEMINI_API_KEY ||
        env.GROK_API_KEY
      );
      if (hasCloudKey) {
        log.warn("Ollama is not reachable, but cloud API keys were detected! Proceeding with cloud models...");
      } else {
        log.error("Ollama is not reachable and no cloud API keys are configured!", health.error);
        log.error("Please start Ollama: `ollama serve` or `docker compose up -d` or configure a cloud API key in your .env");
        process.exit(1);
      }
    } else {
      const ollamaModels = health.value;
      log.info(`Ollama connected — ${ollamaModels.length} models available`);

      // Ensure required local models are pulled
      log.info("Ensuring required local models are available...");
      try {
        if (isLocalModel(Models.FAST)) await ensureModel(Models.FAST);
        if (isLocalModel(Models.PRIMARY)) await ensureModel(Models.PRIMARY);
        
        // Optional models
        if (isLocalModel(Models.CODER)) ensureModel(Models.CODER).catch(() => {});
        if (isLocalModel(Models.EMBED)) ensureModel(Models.EMBED).catch(() => {});
      } catch (e) {
        log.warn("Failed to ensure some models - continuing anyway.");
      }
    }
  } else {
    log.info(`Cloud Provider detected (${primaryModel}) — skipping Ollama check.`);
  }

  // 4. Initialize vector store
  log.info("Initializing vector store...");
  initVectorStore();

  // 5. Start proactive scheduler
  startScheduler();

  // 6. Start Telegram bot (if enabled)
  startTelegramBot();

  // 7. Start Voice Wake Word (if enabled)
  if (env.VOICE_ENABLED) {
    log.info("Preloading STT Whisper model...");
    await preloadWhisperModel().catch((e) => log.error("Failed to preload Whisper", e));
    
    startWakeWordDetection(() => {
      // Phase 1: Simple logging. Phase 2: Active chat integration.
      log.info("🔔 Wake Word Detected! Try saying something in the terminal.");
    }).catch(e => log.error("Voice startup failed", e));
  }

  // 8. Preload offline emotion model (Transformer)
  log.info("Preloading local emotion classifier model...");
  await preloadEmotionModel().catch((e) => log.error("Failed to preload emotion model", e));

  // 9. Calculate startup time
  const elapsed = Date.now() - startTime;
  log.info(`✅ ${env.APP_NAME} ready in ${elapsed}ms`);

  // 10. Start TUI (this blocks — it's the main interaction loop)
  startTUI();

  // ── Graceful Shutdown ───────────────────────────────────────────────────────
  const shutdown = () => {
    log.info("Shutting down...");
    stopScheduler();
    stopTelegramBot();
    stopWakeWordDetection();
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
