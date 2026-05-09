// ════════════════════════════════════════════════════════════════════════════════
// tests/final_audit.ts — Automated System-Wide Final Audit
// ════════════════════════════════════════════════════════════════════════════════

import { env } from "../src/config/index.js";
import { ollamaClient } from "../src/llm/ollama.js";
import { db } from "../src/memory/db.js";
import { processMessage } from "../src/graph/supervisor.js";
import { getSystemInfo } from "../src/tools/laptop/system.js";
import { initVectorStore, addEntry, search } from "../src/memory/vector.js";
import chalk from "chalk";

async function runAudit() {
  console.log(chalk.cyan.bold("\n🚀 CREATER AI ASSISTANT — FINAL SYSTEM AUDIT\n"));
  
  // Initialize Memory
  initVectorStore();

  const results = {
    core: false,
    intelligence: false,
    tools: false,
    safety: false,
    proactive: false,
    interfaces: false,
    memory: false,
  };

  const report = (name: string, status: boolean, detail?: string) => {
    const symbol = status ? chalk.green("✔") : chalk.red("✘");
    console.log(`${symbol} ${chalk.white.bold(name.padEnd(30))} [${status ? chalk.green("PASSED") : chalk.red("FAILED")}]`);
    if (detail) console.log(chalk.gray(`  └─ ${detail}`));
  };

  // 1. Core System Test
  try {
    const info = await getSystemInfo();
    results.core = !!info.cpu && !!info.ram;
    report("Core System Health", results.core, `OS: ${info.os} | CPU: ${info.cpu.model}`);
  } catch (e: any) {
    report("Core System Health", false, e.message);
  }

  // 2. Intelligence & RAG
  try {
    const testFact = `Audited at ${new Date().toISOString()}`;
    await addEntry(testFact, { type: "audit" });
    const retrieved = await search("Audited at", 1);
    results.memory = retrieved.length > 0;
    report("Vector Memory (RAG)", results.memory, `Stored and retrieved audit timestamp successfully.`);
  } catch (e: any) {
    report("Vector Memory (RAG)", false, e.message);
  }

  // 3. Emotion Detection
  try {
    const response = await processMessage("I am feeling very happy and excited today!", "tui");
    results.intelligence = response.length > 0;
    // Check if emotion log recorded
    const lastEmotion = db.prepare("SELECT mood FROM emotion_log ORDER BY created_at DESC LIMIT 1").get() as any;
    const moodPassed = lastEmotion?.mood === "Happy";
    report("Intelligence & Emotion", moodPassed, `Detected Mood: ${lastEmotion?.mood}`);
  } catch (e: any) {
    report("Intelligence & Emotion", false, e.message);
  }

  // 4. Tools & Safety
  try {
    const { validateCommand } = await import("../src/tools/safety.js");
    
    // Check blocked command
    const dangerousCheck = validateCommand("rm -rf / --no-preserve-root");
    const safeCheck = validateCommand("ls -la");
    
    results.safety = !dangerousCheck.allowed && safeCheck.allowed;
    report("Safety Protocols", results.safety, `Safe commands allowed, Critical commands blocked.`);
  } catch (e: any) {
    report("Safety Protocols", false, e.message);
  }

  // 5. Proactive Feature Verification
  try {
    const { generateMorningBriefing } = await import("../src/proactive/briefing.js");
    const briefing = await generateMorningBriefing();
    results.proactive = briefing.length > 0;
    report("Proactive Scheduler", results.proactive, `Morning Briefing generated successfully.`);
  } catch (e: any) {
    report("Proactive Scheduler", false, e.message);
  }

  // 6. Web & Multi-Interface
  try {
    const { existsSync } = await import("fs");
    const webReady = existsSync("./src/web/package.json") && existsSync("./src/web/app/page.tsx");
    const botReady = existsSync("./src/bot/telegram.ts");
    results.interfaces = webReady && botReady;
    report("Interface Readiness", results.interfaces, `TUI, Telegram, and Web components are verified.`);
  } catch (e: any) {
    report("Interface Readiness", false, e.message);
  }

  console.log("\n" + "═".repeat(60));
  const score = Object.values(results).filter(Boolean).length * (100 / 7);
  console.log(chalk.bold(`  OVERALL SYSTEM SCORE: ${Math.round(score)}/100`));
  console.log("═".repeat(60));

  if (score >= 90) {
    console.log(chalk.green.bold("\n  🏆 PRODUCTION READY: Creater is stable and ready for final Voice integration!\n"));
  } else {
    console.log(chalk.yellow.bold("\n  ⚠️  IMPROVEMENTS NEEDED: Some subsystems failed audit.\n"));
  }
}

runAudit().catch(console.error);
