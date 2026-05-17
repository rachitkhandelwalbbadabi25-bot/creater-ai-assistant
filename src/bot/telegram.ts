// ════════════════════════════════════════════════════════════════════════════════
// src/bot/telegram.ts — Telegram bot using Grammy
// ════════════════════════════════════════════════════════════════════════════════

import { Bot } from "grammy";
import { env, allowedTelegramUsers } from "@config/index.js";
import { processMessage } from "@graph/supervisor.js";
import { onBriefingReady } from "@proactive/briefing.js";
import { onNightCheckReady } from "@proactive/nightCheck.js";
import { onAlertReady } from "@proactive/alerts.js";
import { AvailableModels, ProviderAvailability, Models } from "@config/models.js";
import { setModelOverride, getModelOverride } from "@llm/router.js";
import { getAllFacts } from "@memory/longTerm.js";
import { getGraphStats, getTopNodes } from "@memory/graph.js";
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
      `/memory — Memory overview + graph stats\n` +
      `/facts — Full knowledge base (all stored facts)\n` +
      `/graph — Knowledge graph (top nodes)\n` +
      `/briefing — Get your morning briefing now\n` +
      `/models — List all available AI models\n` +
      `/model <name> — Switch AI model (or 'auto' to reset)\n` +
      `/help — Show this message`
    );
  });

  bot.command("models", async (ctx) => {
    const currentOverride = getModelOverride();
    const providers = [
      { name: "Anthropic", key: "anthropic" },
      { name: "OpenAI", key: "openai" },
      { name: "DeepSeek", key: "deepseek" },
      { name: "Gemini", key: "gemini" },
      { name: "Grok", key: "grok" },
    ];

    const lines = [
      "🤖 *CREATER MODEL STATUS & OVERRIDES*",
      "═══════════════════════════════════",
      "🌐 *CLOUD PROVIDERS:*"
    ];

    for (const prov of providers) {
      const isConfigured = (ProviderAvailability as any)[prov.key];
      const statusText = isConfigured ? "🟢 Configured" : "🔴 Not Configured";
      lines.push(`  • *${prov.name}* ─── [${statusText}]`);
      
      const models = Object.values(AvailableModels).filter(m => m.provider === prov.key);
      for (const m of models) {
        const isActive = currentOverride === m.id || (!currentOverride && env.DEFAULT_MODEL === m.id);
        const activeMarker = isActive ? " ➔ *ACTIVE*" : "";
        lines.push(`    - \`${m.id}\` (${m.type})${activeMarker}`);
      }
    }

    lines.push("");
    lines.push("💻 *LOCAL PROVIDERS:*");
    lines.push("  • *Ollama* ─── [🟢 Connected]");
    const localModels = Object.values(AvailableModels).filter(m => m.provider === "ollama");
    for (const m of localModels) {
      const isActive = currentOverride === m.id || (!currentOverride && env.DEFAULT_MODEL === m.id);
      const activeMarker = isActive ? " ➔ *ACTIVE*" : "";
      lines.push(`    - \`${m.id}\` (${m.type})${activeMarker}`);
    }

    lines.push("═══════════════════════════════════");
    lines.push("⚙️ *ROUTING CONFIGURATION:*");
    lines.push(`  • LLM Provider: \`${env.LLM_PROVIDER}\``);
    lines.push(`  • Global Override: ${currentOverride ? `*\`${currentOverride}\`*` : "_None (Auto-Routing)_"}`);
    
    const primaryModel = env.DEFAULT_MODEL || Models.PRIMARY;
    lines.push(`  • Active Primary Model: \`${primaryModel}\``);
    lines.push("");
    lines.push("Type `/model <id>` to force a model, or `/model auto` to clear.");

    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });

  bot.command("model", async (ctx) => {
    const args = ctx.message?.text.split(" ").slice(1).join(" ").trim();
    if (!args) {
      const cur = getModelOverride();
      await ctx.reply(
        cur
          ? `🤖 Current model: \`${cur}\`. Use /model auto to reset.`
          : `⚡ Auto-routing ACTIVE. Use /model <model-id> to override.`,
        { parse_mode: "Markdown" }
      );
      return;
    }
    if (args === "auto" || args === "none") {
      setModelOverride(null);
      await ctx.reply("⚡ Model override cleared. Auto-routing is now active.");
    } else if (AvailableModels[args]) {
      setModelOverride(args);
      await ctx.reply(`✅ Model set to: \`${args}\``, { parse_mode: "Markdown" });
    } else {
      await ctx.reply(`❌ Unknown model: \`${args}\`\nType /models to see the full list.`, { parse_mode: "Markdown" });
    }
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
    const graphStats = getGraphStats();
    const allFacts = getAllFacts();
    
    const memMsg = 
      `🧠 **Memory & Knowledge:**\n\n` +
      `• **Current Vibe:** ${emotion}\n` +
      `• **Facts stored:** ${allFacts.length}\n` +
      `• **Graph nodes:** ${graphStats.nodeCount} | **Edges:** ${graphStats.edgeCount}\n\n` +
      `📌 **Recent Key Facts:**\n` +
      (summaries.length ? summaries.map(s => `  - ${s.content.slice(0, 100)}...`).join("\n") : "  - No long-term facts stored yet.") +
      `\n\nType /facts for full knowledge base or /graph for the knowledge graph.`;
      
    await ctx.reply(memMsg, { parse_mode: "Markdown" });
  });

  bot.command("facts", async (ctx) => {
    await ctx.replyWithChatAction("typing");
    const allFacts = getAllFacts();
    if (allFacts.length === 0) {
      await ctx.reply("🧠 No facts stored yet. Keep chatting and I'll learn about you!");
      return;
    }
    const grouped = new Map<string, typeof allFacts>();
    for (const f of allFacts) {
      const arr = grouped.get(f.category) ?? [];
      arr.push(f);
      grouped.set(f.category, arr);
    }
    const lines: string[] = ["🧠 **Your Knowledge Base:**\n"];
    for (const [cat, facts] of grouped) {
      lines.push(`\n📂 *${cat.toUpperCase()}*`);
      for (const f of facts.slice(0, 10)) {
        lines.push(`  • ${f.key}: ${f.value}`);
      }
      if (facts.length > 10) lines.push(`  _...and ${facts.length - 10} more_`);
    }
    lines.push(`\n📊 **Total:** ${allFacts.length} facts`);
    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });

  bot.command("graph", async (ctx) => {
    await ctx.replyWithChatAction("typing");
    const stats = getGraphStats();
    const topNodes = getTopNodes(10);
    const lines: string[] = [
      `🕸️ **Memory Graph**\n`,
      `Nodes: *${stats.nodeCount}* | Edges: *${stats.edgeCount}* | Archived: ${stats.archivedCount}\n`,
    ];
    if (topNodes.length === 0) {
      lines.push("_No nodes yet — facts auto-populate the graph as you chat._");
    } else {
      for (const n of topNodes) {
        lines.push(`  \`[${n.type}]\` ${n.label}`);
      }
    }
    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
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
