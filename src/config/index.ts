// ════════════════════════════════════════════════════════════════════════════════
// src/config/index.ts — Central configuration loader
// Reads from .env and exports typed config objects used across the entire app.
// ════════════════════════════════════════════════════════════════════════════════

import { z } from "zod";

// ─── Environment Schema (validated at startup) ──────────────────────────────────
const EnvSchema = z.object({
  // App Identity
  APP_NAME: z.string().default("Creater"),
  APP_ENV: z.enum(["development", "production", "test"]).default("development"),
  APP_LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  USER_NAME: z.string().default("Friend"),
  USER_TIMEZONE: z.string().default("Asia/Kolkata"),

  // Ollama
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_TIMEOUT_MS: z.coerce.number().default(120000),
  OLLAMA_PRIMARY_MODEL: z.string().default("qwen2.5:14b"),
  OLLAMA_FAST_MODEL: z.string().default("qwen2.5:3b"),
  OLLAMA_CODER_MODEL: z.string().default("qwen2.5-coder:7b"),
  OLLAMA_EMBED_MODEL: z.string().default("nomic-embed-text:latest"),

  // Memory & DB
  SQLITE_DB_PATH: z.string().default("./data/creater.db"),
  VECTOR_DB_PATH: z.string().default("./data/vectors"),
  SHORT_TERM_TTL_HOURS: z.coerce.number().default(4),
  MID_TERM_TTL_DAYS: z.coerce.number().default(30),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_ALLOWED_USERS: z.string().default(""),
  TELEGRAM_ENABLED: z.coerce.boolean().default(false),

  // Voice
  VOICE_ENABLED: z.coerce.boolean().default(false),
  WHISPER_MODEL: z.string().default("base"),
  PIPER_VOICE: z.string().default("en_US-lessac-medium"),
  WAKE_WORD: z.string().default("hey creater"),
  PICOVOICE_ACCESS_KEY: z.string().default(""),

  // Proactive Scheduler
  PROACTIVE_ENABLED: z.coerce.boolean().default(true),
  MORNING_BRIEFING_CRON: z.string().default("0 7 * * *"),
  NIGHT_CHECK_CRON: z.string().default("0 22 * * *"),
  DEADLINE_CHECK_CRON: z.string().default("0 9,15 * * *"),

  // Browser
  PLAYWRIGHT_HEADLESS: z.coerce.boolean().default(true),
  PLAYWRIGHT_BROWSER: z.enum(["chromium", "firefox", "webkit"]).default("chromium"),

  // Safety
  SAFETY_MODE: z.enum(["strict", "moderate", "permissive"]).default("strict"),
  REQUIRE_CONFIRMATION_FOR: z.string().default("shell,file-delete,browser-write"),
  MAX_SHELL_TIMEOUT_MS: z.coerce.number().default(30000),

  // Skills
  SKILLS_DIR: z.string().default("./src/skills/storage"),
  AUTO_GENERATE_SKILLS: z.coerce.boolean().default(true),

  // Web Dashboard
  WEB_DASHBOARD_PORT: z.coerce.number().default(3000),
  WEB_DASHBOARD_ENABLED: z.coerce.boolean().default(false),

  // Debug
  DEBUG_LLM_CALLS: z.coerce.boolean().default(false),
  DEBUG_MEMORY: z.coerce.boolean().default(false),
  DEBUG_TOOLS: z.coerce.boolean().default(false),
  MOCK_LLM: z.coerce.boolean().default(false),
});

// ─── Parse and validate environment at module load ───────────────────────────────
const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

// ─── Derived helpers ─────────────────────────────────────────────────────────────
export const isDev = env.APP_ENV === "development";
export const isProd = env.APP_ENV === "production";

/** Telegram user IDs that are allowed to interact with the bot */
export const allowedTelegramUsers: number[] = env.TELEGRAM_ALLOWED_USERS
  ? env.TELEGRAM_ALLOWED_USERS.split(",").map((id) => parseInt(id.trim(), 10))
  : [];

/** Tool types that require explicit user confirmation before executing */
export const confirmationRequiredFor: string[] = env.REQUIRE_CONFIRMATION_FOR
  ? env.REQUIRE_CONFIRMATION_FOR.split(",").map((t) => t.trim())
  : [];

export type AppEnv = typeof env;
