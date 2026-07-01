// src/scripts/ollama_benchmark.ts
import { env } from "../config/index.ts";
import { ollamaClient as client } from "../llm/ollama.ts";

interface RunMetrics {
  run: number;
  totalMs: number;
  firstTokenMs?: number;
  loadMs: number;
  promptEvalMs: number;
  evalMs: number;
}

async function runOnce(runNumber: number): Promise<RunMetrics> {
  const start = performance.now();
  let firstTokenMs: number | undefined;
  let firstTokenCaptured = false;

  const response = await client.chat({
    model: env.OLLAMA_PRIMARY_MODEL ?? "qwen2.5:3b",
    messages: [{ role: "user", content: "Hello" }],
    stream: true,
  } as any);

  let stats: any;
  for await (const chunk of response as AsyncIterable<any>) {
    const token = chunk.message?.content ?? "";
    if (!firstTokenCaptured && token.length > 0) {
      firstTokenCaptured = true;
      firstTokenMs = Math.round(performance.now() - start);
    }
    stats = chunk;
  }

  const end = performance.now();
  const totalMs = Math.round(end - start);
  const loadMs = Math.round((Number(stats.load_duration) || 0) / 1e6);
  const promptEvalMs = Math.round((Number(stats.prompt_eval_duration) || 0) / 1e6);
  const evalMs = Math.round((Number(stats.eval_duration) || 0) / 1e6);
  console.log(`[RUN_${runNumber}] totalMs=${totalMs} firstTokenMs=${firstTokenMs ?? "-"} loadMs=${loadMs} promptEvalMs=${promptEvalMs} evalMs=${evalMs}`);
  return { run: runNumber, totalMs, firstTokenMs, loadMs, promptEvalMs, evalMs };
}

async function main() {
  const results: RunMetrics[] = [];
  for (let i = 1; i <= 5; i++) {
    const metrics = await runOnce(i);
    results.push(metrics);
  }
  console.log("\n=== Comparison of loadMs across runs ===");
  results.forEach(r => console.log(`Run ${r.run}: loadMs=${r.loadMs}`));
  const firstLoad = results[0].loadMs;
  const decreasing = results.slice(1).every(r => r.loadMs <= firstLoad);
  console.log(`\nDoes loadMs decrease after the first request? ${decreasing ? "Yes" : "No"}`);
}

main().catch(err => {
  console.error("Benchmark execution failed:", err);
});
