// ════════════════════════════════════════════════════════════════════════════════
// src/bot/telegram.ts — Telegram bot using Grammy
// ════════════════════════════════════════════════════════════════════════════════

import { Bot } from "grammy";
import { env, allowedTelegramUsers } from "@config/index.js";
import { processMessage } from "@graph/supervisor.js";
import { onBriefingReady } from "@proactive/briefing.js";
import { onNightCheckReady } from "@proactive/nightCheck.js";
import { onAlertReady } from "@proactive/alerts.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("bot/telegram");

let bot: Bot | null = null;
let activeChatId: number | null = null;

/**
 * Start the Telegram bot.
 * Only processes messages from allowed user IDs (security whitelist).
 */
export function startTelegramBot(): void {
  if (!env.TELEGRAM_ENABLED || !env.TELEGRAM_BOT_TOKEN) {
    log.info("Telegram bot disabled — set TELEGRAM_ENABLED=true and TELEGRAM_BOT_TOKEN");
    return;
  }

  bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  // ── Security: Only allow whitelisted users ──────────────────────────────────
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId || (allowedTelegramUsers.length > 0 && !allowedTelegramUsers.includes(userId))) {
      log.warn(`Unauthorized Telegram user: ${userId}`);
      await ctx.reply("⛔ Sorry, you're not authorized to use this bot.");
      return;
    }
    await next();
  });

  // ── Commands ────────────────────────────────────────────────────────────────
  bot.command("start", async (ctx) => {
    activeChatId = ctx.chat.id;
    await ctx.reply(
      `👋 Hey! Main Creater hoon — tumhara personal AI assistant!\n\n` +
      `Mujhse kuch bhi poocho — Hindi, English, ya Hinglish mein.\n` +
      `Type /help for commands.`
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      `📋 **Commands:**\n` +
      `/start — Start conversation\n` +
      `/status — System status\n` +
      `/briefing — Get morning briefing\n` +
      `/help — Show this message`
    );
  });

  bot.command("status", async (ctx) => {
    await ctx.reply("✅ Creater is running! Sab theek hai.");
  });

  bot.command("briefing", async (ctx) => {
    await ctx.reply("⏳ Generating briefing...");
    const response = await processMessage("give me my morning briefing", "telegram");
    await ctx.reply(response);
  });

  // ── Handle all text messages ────────────────────────────────────────────────
  bot.on("message:text", async (ctx) => {
    activeChatId = ctx.chat.id;
    const text = ctx.message.text;

    log.info(`Telegram message from ${ctx.from?.first_name}: "${text.slice(0, 80)}"`);

    // Show typing indicator
    await ctx.replyWithChatAction("typing");

    const response = await processMessage(text, "telegram");
    await ctx.reply(response, { parse_mode: "Markdown" });
  });

  // ── Register proactive delivery callbacks ───────────────────────────────────
  const sendProactive = async (message: string) => {
    if (bot && activeChatId) {
      try { await bot.api.sendMessage(activeChatId, message); }
      catch (e) { log.warn("Failed to send proactive message", { error: String(e) }); }
    }
  };

  onBriefingReady(sendProactive);
  onNightCheckReady(sendProactive);
  onAlertReady(sendProactive);

  // ── Start polling ───────────────────────────────────────────────────────────
  bot.start({
    onStart: () => log.info("Telegram bot started"),
  });

  log.info("Telegram bot initialized");
}

export function stopTelegramBot(): void {
  if (bot) {
    bot.stop();
    log.info("Telegram bot stopped");
  }
}
