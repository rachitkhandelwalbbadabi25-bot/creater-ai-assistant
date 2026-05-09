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
      `👋 Hey! Main ${env.APP_NAME} hoon — tumhara personal AI assistant!\n\n` +
      `Mujhse kuch bhi poocho — Hindi, English, ya Hinglish mein.\n` +
      `Type /help for commands.`
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      `📋 **Available Commands:**\n\n` +
      `/start — Start conversation\n` +
      `/status — Detailed system status\n` +
      `/memory — View what I remember about you\n` +
      `/briefing — Get your morning briefing now\n` +
      `/help — Show this message`
    );
  });

  bot.command("status", async (ctx) => {
    await ctx.replyWithChatAction("typing");
    try {
      const { getSystemInfo } = await import("@tools/laptop/system.js");
      const sys = await getSystemInfo();
      const status = 
        `🖥️ **System Status:**\n\n` +
        `• **CPU:** ${sys.cpu.usage}% (${sys.cpu.model})\n` +
        `• **RAM:** ${sys.ram.usagePercent}% (${sys.ram.used}/${sys.ram.total})\n` +
        `• **Battery:** ${sys.battery?.percent ?? "AC Power"}% ${sys.battery?.charging ? "(Charging)" : ""}\n` +
        `• **Uptime:** ${Math.floor(process.uptime() / 60)} mins\n` +
        `• **OS:** ${process.platform} (${process.arch})`;
      await ctx.reply(status, { parse_mode: "Markdown" });
    } catch (e) {
      await ctx.reply("✅ Bot is online, but system stats fetch failed.");
    }
  });

  bot.command("memory", async (ctx) => {
    await ctx.replyWithChatAction("typing");
    const { getTopSummaries } = await import("@memory/midTerm.js");
    const { buildEmotionProfile } = await import("@emotion/personalMap.js");
    
    const summaries = getTopSummaries(3);
    const emotion = buildEmotionProfile();
    
    const memMsg = 
      `🧠 **Memory & Profile:**\n\n` +
      `• **Current Vibe:** ${emotion}\n\n` +
      `• **Recent Key Facts:**\n` +
      (summaries.length ? summaries.map(s => `  - ${s.content.slice(0, 100)}...`).join("\n") : "  - No long-term facts stored yet.");
      
    await ctx.reply(memMsg, { parse_mode: "Markdown" });
  });

  bot.command("briefing", async (ctx) => {
    await ctx.reply("⏳ Generating your morning briefing, please wait...");
    await ctx.replyWithChatAction("typing");
    const { generateMorningBriefing } = await import("@proactive/briefing.js");
    const briefing = await generateMorningBriefing();
    await ctx.reply(briefing, { parse_mode: "Markdown" });
  });

  bot.command("voice", async (ctx) => {
    const args = ctx.message?.text.split(" ")[1]?.toLowerCase();
    if (args === "on") {
      import("@voice/wakeWord.js").then(m => m.startWakeWordDetection(() => {}));
      await ctx.reply("🎙️ Background Voice Detection (Hey Creater) Started.");
    } else if (args === "off") {
      import("@voice/wakeWord.js").then(m => m.stopWakeWordDetection());
      await ctx.reply("🔇 Background Voice Detection Stopped.");
    } else {
      await ctx.reply("ℹ️ Usage: `/voice on` or `/voice off`", { parse_mode: "Markdown" });
    }
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
    if (!bot) return;
    
    // Send to current active chat if known
    if (activeChatId) {
      try { await bot.api.sendMessage(activeChatId, message, { parse_mode: "Markdown" }); }
      catch (e) { log.warn("Failed to send proactive to active chat"); }
    } else {
      // Fallback: Send to all whitelisted users
      for (const userId of allowedTelegramUsers) {
        try { await bot.api.sendMessage(userId, message, { parse_mode: "Markdown" }); }
        catch (e) { log.warn(`Failed to send proactive to user ${userId}`); }
      }
    }
  };

  onBriefingReady(sendProactive);
  onNightCheckReady(sendProactive);
  onAlertReady(sendProactive);

  // ── Start polling ───────────────────────────────────────────────────────────
  bot.start({
    onStart: (info) => log.info(`Telegram bot started as @${info.username}`),
  });

  log.info("Telegram bot initialized");
}

export function stopTelegramBot(): void {
  if (bot) {
    bot.stop();
    log.info("Telegram bot stopped");
  }
}
