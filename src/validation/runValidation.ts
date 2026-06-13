import { takeMemorySnapshot, printMemoryReport } from "../scripts/memorySnapshot.js";
import { verifyStreamClean } from "./streamDiagnostics.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

async function runCommand(command: string): Promise<void> {
  try {
    const { stdout, stderr } = await execAsync(command);
    console.log(`[CMD] ${command}\n${stdout}`);
    if (stderr) console.error(`[CMD ERR] ${stderr}`);
  } catch (err) {
    console.error(`[CMD FAIL] ${command}`, err);
  }
}

async function stressLoop(durationMs: number): Promise<void> {
  const start = Date.now();
  console.log('🔧 Starting Phase 3.5 stress test');
  while (Date.now() - start < durationMs) {
    // Example deterministic commands to exercise the agent
    await runCommand('bun run src/index.ts "open gmail"');
    await runCommand('bun run src/index.ts "open youtube"');
    await runCommand('bun run src/index.ts "open chrome"');
    // Snapshot memory & stream diagnostics
    printMemoryReport();
    await verifyStreamClean();
    // Small pause
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log('✅ Stress test completed');
}

(async (): Promise<void> => {
  // Take baseline snapshot
  takeMemorySnapshot();
  // Run for 20 minutes (1200000 ms)
  await stressLoop(20 * 60 * 1000);
})();
