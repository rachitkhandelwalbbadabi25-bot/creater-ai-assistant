import { env } from "@config/index.js";

type OllamaMetricChunk = {
  done?: boolean;
  message?: {
    role?: string;
    content?: string;
  };
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
  total_duration?: number;
};

type BenchmarkResult = {
  run: number;
  streamObjectMs: number;
  firstTokenMs: number | null;
  loadDurationMs: number;
  promptEvalMs: number;
  evalMs: number;
  totalMs: number;
  promptEvalCount: number;
  evalCount: number;
};

const args = new Map<string, string>();
for (let index = 2; index < Bun.argv.length; index += 2) {
  const key = Bun.argv[index];
  const value = Bun.argv[index + 1];
  if (key?.startsWith("--") && value != null) {
    args.set(key.slice(2), value);
  }
}

const model = args.get("model") ?? env.OLLAMA_PRIMARY_MODEL;
const runs = Number(args.get("runs") ?? 3);
const numCtx = Number(args.get("num-ctx") ?? 2048);
const numPredict = Number(args.get("num-predict") ?? 34);
const prompt = args.get("prompt") ?? "Reply with one short sentence: hello.";
const baseUrl = env.OLLAMA_BASE_URL.replace(/\/$/, "");
const keepAlive = env.OLLAMA_KEEP_ALIVE;

function nsToMs(value?: number): number {
  return Math.round(Number(value ?? 0) / 1e6);
}

async function fetchJson(path: string): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    return { error: `${response.status} ${response.statusText}` };
  }
  return await response.json();
}

async function runChat(run: number): Promise<BenchmarkResult> {
  const payload = {
    model,
    messages: [{ role: "user", content: prompt }],
    options: {
      num_ctx: numCtx,
      num_predict: numPredict,
      temperature: 0,
    },
    keep_alive: keepAlive,
    stream: true,
  };

  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const streamObjectMs = Math.round(performance.now() - startedAt);

  if (!response.ok || response.body == null) {
    throw new Error(`Ollama chat failed: ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let firstTokenMs: number | null = null;
  let finalChunk: OllamaMetricChunk | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const chunk = JSON.parse(trimmed) as OllamaMetricChunk;
      const token = chunk.message?.content ?? "";
      if (firstTokenMs == null && token.length > 0) {
        firstTokenMs = Math.round(performance.now() - startedAt);
      }
      if (chunk.done) {
        finalChunk = chunk;
      }
    }
  }

  if (!finalChunk) {
    throw new Error("Ollama stream ended without a final metrics chunk");
  }

  return {
    run,
    streamObjectMs,
    firstTokenMs,
    loadDurationMs: nsToMs(finalChunk.load_duration),
    promptEvalMs: nsToMs(finalChunk.prompt_eval_duration),
    evalMs: nsToMs(finalChunk.eval_duration),
    totalMs: nsToMs(finalChunk.total_duration),
    promptEvalCount: Number(finalChunk.prompt_eval_count ?? 0),
    evalCount: Number(finalChunk.eval_count ?? 0),
  };
}

console.log("[OLLAMA_LOAD_BENCH_CONFIG]", JSON.stringify({
  baseUrl,
  model,
  runs,
  keep_alive: keepAlive,
  options: { num_ctx: numCtx, num_predict: numPredict, temperature: 0 },
  payloadChars: JSON.stringify([{ role: "user", content: prompt }]).length,
}, null, 2));

console.log("[OLLAMA_PS_BEFORE]", JSON.stringify(await fetchJson("/api/ps"), null, 2));

const results: BenchmarkResult[] = [];
for (let run = 1; run <= runs; run++) {
  const result = await runChat(run);
  results.push(result);
  console.log("[OLLAMA_LOAD_BENCH_RUN]", JSON.stringify(result, null, 2));
  console.log("[OLLAMA_PS_AFTER_RUN]", JSON.stringify({
    run,
    ps: await fetchJson("/api/ps"),
  }, null, 2));
}

console.log("[OLLAMA_LOAD_BENCH_SUMMARY]", JSON.stringify(results, null, 2));
