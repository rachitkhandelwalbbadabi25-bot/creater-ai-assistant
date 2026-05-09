// ════════════════════════════════════════════════════════════════════════════════
// diagnostic.ts — Comprehensive System Health Check for Creater AI
// ════════════════════════════════════════════════════════════════════════════════

import { env } from "./src/config/index.js";
import { checkOllamaHealth } from "./src/llm/ollama.js";
import { db } from "./src/memory/db.js";
import { existsSync } from "fs";
import { Models } from "./src/config/models.js";
import chalk from "chalk";

async function runDiagnostic() {
  console.log(chalk.cyan.bold("\n🔍 CREATER AI ASSISTANT — SYSTEM DIAGNOSTIC\n"));

  let passed = 0;
  let failed = 0;

  const check = async (name: string, fn: () => Promise<void> | void) => {
    process.stdout.write(chalk.white(`  • ${name.padEnd(35)} `));
    try {
      await fn();
      console.log(chalk.green.bold("OK"));
      passed++;
    } catch (e: any) {
      console.log(chalk.red.bold("FAILED"));
      console.log(chalk.red(`    ❌ ${e.message || e}`));
      failed++;
    }
  };

  // 1. Environment & Config
  await check("Environment Configuration", () => {
    if (!env.APP_NAME) throw new Error("APP_NAME not set");
  });

  // 2. Ollama & Models
  await check("Ollama Connectivity", async () => {
    const health = await checkOllamaHealth();
    if (!health.ok) throw new Error(health.error);
    const models = health.value; // These are strings in the current logger output
    
    // Check required models (flexible matching with/without tags)
    // If models are objects, use m.name. If they are strings, use m.
    const modelNames = models.map((m: any) => typeof m === "string" ? m : m.name);
    const available = modelNames.map((name: string) => name.split(":")[0]);
    
    const primaryBase = Models.PRIMARY.split(":")[0];
    const embedBase = Models.EMBED.split(":")[0];

    if (!available.includes(primaryBase)) throw new Error(`Primary model ${Models.PRIMARY} missing`);
    if (!available.includes(embedBase)) throw new Error(`Embedding model ${Models.EMBED} missing`);
  });

  // 3. Database & Persistence
  await check("SQLite Database Integrity", () => {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    if (row.length === 0) throw new Error("Database has no tables");
  });

  await check("Vector Store Path", () => {
    if (!existsSync(env.VECTOR_DB_PATH)) {
      throw new Error(`Vector path missing: ${env.VECTOR_DB_PATH}`);
    }
  });

  // 4. Critical Dependencies
  await check("Core Tools Loading", async () => {
    // Using absolute paths for dynamic imports in diagnostic script
    const path = await import("path");
    const sysPath = path.join(process.cwd(), "src", "tools", "laptop", "system.ts");
    const fsPath = path.join(process.cwd(), "src", "tools", "laptop", "fileSystem.ts");
    await import(sysPath);
    await import(fsPath);
  });

  // 5. Telegram (Optional)
  if (env.TELEGRAM_ENABLED) {
    await check("Telegram Bot Config", () => {
      if (!env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN === "your_bot_token_here") {
        throw new Error("Telegram enabled but token is default/missing");
      }
    });
  }

  // 6. Proactive Scheduler
  await check("Proactive Scheduler", () => {
    if (!env.PROACTIVE_ENABLED) throw new Error("Scheduler is disabled in config");
  });

  console.log("\n" + "═".repeat(50));
  console.log(chalk.bold(`  RESULT: ${passed} Passed, ${failed} Failed`));
  console.log("═".repeat(50));

  if (failed > 0) {
    console.log(chalk.yellow("\n  ⚠️  Please fix the failing checks before starting the assistant.\n"));
    process.exit(1);
  } else {
    console.log(chalk.green.bold("\n  ✨ All systems nominal. Creater is ready for deployment!\n"));
    process.exit(0);
  }
}

runDiagnostic().catch((e) => {
  console.error(chalk.red("\n  💥 Fatal Diagnostic Error:"), e);
  process.exit(1);
});
