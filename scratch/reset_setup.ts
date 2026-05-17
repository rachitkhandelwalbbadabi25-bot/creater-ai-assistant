// scratch/reset_setup.ts — Clear the database settings to trigger the First-Run Wizard
import { db } from "../src/memory/db.ts";

try {
  db.prepare("DELETE FROM settings").run();
  console.log("✅ All settings deleted! Settings database is completely clean.");
  console.log("🚀 Run 'bun run start' or 'bun run dev' to trigger the First-Run Setup Wizard!");
} catch (err) {
  console.error("❌ Failed to clear settings:", err);
}
