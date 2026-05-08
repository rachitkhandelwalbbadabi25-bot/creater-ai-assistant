import { env } from "./src/config/index.js";
import { ollamaClient } from "./src/llm/ollama.js";
import { db } from "./src/memory/db.js";

async function main() {
  console.log("--- Creater AI Assistant Diagnostic ---");
  console.log("App Name:", env.APP_NAME);
  
  console.log("\n1. Testing Ollama Connectivity...");
  try {
    const tags = await ollamaClient.list();
    console.log("SUCCESS: Ollama connected. Models found:", (tags as any).models.length);
  } catch (e) {
    console.error("FAILURE: Ollama connection failed. Is it running on port 11434?");
    console.error(e);
  }
  
  console.log("\n2. Testing SQLite Database...");
  try {
    // db is already initialized on import in src/memory/db.ts
    const row = db.prepare("SELECT datetime('now') as now").get();
    console.log("SUCCESS: Database reachable. Current DB Time:", (row as any).now);
  } catch (e) {
    console.error("FAILURE: Database access failed.");
    console.error(e);
  }
  
  console.log("\n3. Testing Import Map...");
  try {
    const { createLogger } = await import("./src/utils/logger.js");
    const testLog = createLogger("test");
    testLog.info("Logger imported successfully.");
    console.log("SUCCESS: Core modules imported.");
  } catch (e) {
    console.error("FAILURE: Module imports failed.");
    console.error(e);
  }
  
  console.log("\n--- Diagnostic Complete ---");
}

main();
