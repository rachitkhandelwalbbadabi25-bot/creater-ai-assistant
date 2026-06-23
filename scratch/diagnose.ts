// scratch/diagnose.ts — Step-by-step pipeline diagnostic check
import { ollamaClient } from "../src/llm/ollama.ts";
import { chat } from "../src/llm/client.ts";
import { classifyIntent } from "../src/llm/router.ts";
import { detectEmotion } from "../src/emotion/detector.ts";
import { retrieveContext } from "../src/memory/retriever.ts";
import { processMessageStreaming } from "../src/graph/supervisor.ts";
import { initVectorStore, addEntry, search } from "../src/memory/vector.ts";

// ─── Timeout Wrapper ─────────────────────────────────────────────────────────────
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  stepName: string
): Promise<T> {
  let timeoutId: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timeout of ${timeoutMs}ms exceeded on step: ${stepName}`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Main Diagnostics ────────────────────────────────────────────────────────────
async function runDiagnostics() {
  console.log("====================================================================");
  console.log("⚙️  CREATER AI ASSISTANT — DIAGNOSTIC SYSTEM CHECK ⚙️");
  console.log("====================================================================\n");

  const results: Record<string, { ok: boolean; time?: number; error?: string; detail?: string }> = {};

  // --------------------------------------------------------------------------------
  // STEP 1 — Ollama Direct Test
  // --------------------------------------------------------------------------------
  console.log("👉 STEP 1: Testing Ollama Direct Connection...");
  try {
    const start = Date.now();
    await withTimeout(
      ollamaClient.chat({
        model: "qwen2.5:3b",
        messages: [{ role: "user", content: "hello" }],
        stream: false,
      }),
      30000,
      "Ollama Direct Test"
    );
    const elapsed = Date.now() - start;
    console.log(`✅ Ollama OK — ${elapsed}ms\n`);
    results["Step 1: Ollama Direct"] = { ok: true, time: elapsed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`❌ Ollama FAILED — ${msg}\n`);
    results["Step 1: Ollama Direct"] = { ok: false, error: msg };
  }

  // --------------------------------------------------------------------------------
  // STEP 2 — LLM Client Test
  // --------------------------------------------------------------------------------
  console.log("👉 STEP 2: Testing LLM Client...");
  try {
    const start = Date.now();
    const reply = await withTimeout(
      chat({
        model: "qwen2.5:3b",
        messages: [{ role: "user", content: "Say hello in one word" }],
      }),
      30000,
      "LLM Client Test"
    );
    const elapsed = Date.now() - start;
    console.log(`✅ LLM Client OK — ${elapsed}ms (Response: "${reply}")\n`);
    results["Step 2: LLM Client"] = { ok: true, time: elapsed, detail: reply };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`❌ LLM Client FAILED — ${msg}\n`);
    results["Step 2: LLM Client"] = { ok: false, error: msg };
  }

  // --------------------------------------------------------------------------------
  // STEP 3 — Intent Classification Test
  // --------------------------------------------------------------------------------
  console.log("👉 STEP 3: Testing Intent Classification...");
  try {
    const start = Date.now();
    const result = await withTimeout(
      classifyIntent("hello"),
      30000,
      "Intent Classification Test"
    );
    const elapsed = Date.now() - start;
    if (!result.ok) throw result.error;
    console.log(`✅ Intent OK — intent: ${result.value.intent}, ${elapsed}ms\n`);
    results["Step 3: Intent Classification"] = { ok: true, time: elapsed, detail: result.value.intent };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`❌ Intent FAILED — ${msg}\n`);
    results["Step 3: Intent Classification"] = { ok: false, error: msg };
  }

  // --------------------------------------------------------------------------------
  // STEP 4 — Emotion Detection Test
  // --------------------------------------------------------------------------------
  console.log("👉 STEP 4: Testing Emotion Detection (ML Model Preload)...");
  try {
    const start = Date.now();
    const result = await withTimeout(
      detectEmotion("hello"),
      20000,
      "Emotion Detection Test"
    );
    const elapsed = Date.now() - start;
    console.log(`✅ Emotion OK — mood: ${result.mood}, ${elapsed}ms\n`);
    results["Step 4: Emotion Detection"] = { ok: true, time: elapsed, detail: result.mood };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`❌ Emotion FAILED — ${msg}\n`);
    results["Step 4: Emotion Detection"] = { ok: false, error: msg };
  }

  // --------------------------------------------------------------------------------
  // STEP 5 — Memory Retriever Test
  // --------------------------------------------------------------------------------
  console.log("👉 STEP 5: Testing Memory Retriever...");
  try {
    const start = Date.now();
    const context = await withTimeout(
      retrieveContext({ query: "hello", recentMessageCount: 3, semanticResultCount: 2 }),
      15000,
      "Memory Retriever Test"
    );
    const elapsed = Date.now() - start;
    console.log(`✅ Memory OK — ${elapsed}ms (${context.relevantMemories.length} relevant memories found)\n`);
    results["Step 5: Memory Retriever"] = { ok: true, time: elapsed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`❌ Memory FAILED — ${msg}\n`);
    results["Step 5: Memory Retriever"] = { ok: false, error: msg };
  }

  // --------------------------------------------------------------------------------
  // STEP 6 — Full Pipeline Test
  // --------------------------------------------------------------------------------
  console.log("👉 STEP 6: Testing Full Supervisor Pipeline...");
  try {
    const start = Date.now();
    let streamedText = "";
    const response = await withTimeout(
      processMessageStreaming("hello", "tui", (token) => { streamedText += token; }),
      60000,
      "Full Pipeline Test"
    );
    const final = streamedText || response;
    const elapsed = Date.now() - start;
    console.log(`✅ Pipeline OK — response: "${final}", ${elapsed}ms\n`);
    results["Step 6: Full Pipeline"] = { ok: true, time: elapsed, detail: final };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`❌ Pipeline FAILED — ${msg}\n`);
    results["Step 6: Full Pipeline"] = { ok: false, error: msg };
  }

  // --------------------------------------------------------------------------------
  // STEP 7 — Vector Store Test
  // --------------------------------------------------------------------------------
  console.log("👉 STEP 7: Testing Vector Store (Embedding generation)...");
  try {
    const start = Date.now();
    initVectorStore();
    const entry = await withTimeout(
      addEntry("This is a diagnostic vector entry to verify embeddings", { type: "test" }),
      30000,
      "Vector Add Entry"
    );
    const searchResults = await withTimeout(
      search("diagnostic vector", 1),
      30000,
      "Vector Search"
    );
    const elapsed = Date.now() - start;
    console.log(`✅ Vector OK — ${elapsed}ms (Result: "${searchResults[0]?.entry.text ?? "None"}")\n`);
    results["Step 7: Vector Store"] = { ok: true, time: elapsed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`❌ Vector FAILED — ${msg}\n`);
    results["Step 7: Vector Store"] = { ok: false, error: msg };
  }

  // ─── Diagnostic Summary ────────────────────────────────────────────────────────
  console.log("====================================================================");
  console.log("📊 DIAGNOSTIC RESULTS SUMMARY");
  console.log("====================================================================");
  
  let hasFailures = false;
  for (const [step, res] of Object.entries(results)) {
    if (res.ok) {
      console.log(`  🟢 ${step}: PASSED (${res.time}ms)`);
    } else {
      console.log(`  🔴 ${step}: FAILED — Error: ${res.error}`);
      hasFailures = true;
    }
  }
  console.log("====================================================================\n");

  // ─── Actionable Recommendations ──────────────────────────────────────────────────
  console.log("💡 RECOMMENDATIONS & TROUBLESHOOTING:");
  console.log("-------------------------------------");

  if (!results["Step 1: Ollama Direct"]?.ok) {
    console.log("🚨 OLLAMA IS DISCONNECTED or UNREACHABLE!");
    console.log("  - Ensure Ollama is running (`ollama serve` or standard launcher desktop app).");
    console.log("  - Make sure the 'qwen2.5:3b' model is fully downloaded. Run: `ollama pull qwen2.5:3b`");
    return;
  }

  if (!results["Step 4: Emotion Detection"]?.ok) {
    console.log("🚨 EMOTION DETECTOR STALLED!");
    console.log("  - The hybrid emotion detector uses a local HuggingFace roberta model via `@xenova/transformers`.");
    console.log("  - On the very first run, it dynamically downloads ~300MB of weights from HuggingFace to your local cache.");
    console.log("  - This download runs synchronously in Node's main thread and BLOCKS the entire event loop, causing 'missed cron' warnings.");
    console.log("  - Fix: Please wait a couple of minutes to let it finish downloading once, or disable ML preloading at startup.");
  }

  if (!results["Step 7: Vector Store"]?.ok) {
    console.log("🚨 VECTOR STORE EMBEDDING STALLED!");
    console.log("  - The vector database requires an embedding model from Ollama (by default 'nomic-embed-text').");
    console.log("  - If this model is missing, Ollama blocks while attempting to run embeddings.");
    console.log("  - Fix: Pull the embedding model manually. Run in your terminal:");
    console.log("         `ollama pull nomic-embed-text`");
  }

  if (results["Step 1: Ollama Direct"]?.ok && results["Step 2: LLM Client"]?.ok && results["Step 3: Intent Classification"]?.ok && !results["Step 6: Full Pipeline"]?.ok) {
    console.log("🚨 AGENT STATE GRAPH IS STALLED!");
    console.log("  - Your Ollama connection is healthy, but the LangGraph/StateGraph supervisor execution times out.");
    console.log("  - Verify that your agents (taskAgent, projectAgent, laptopAgent) are resolving and returning proper states.");
  }

  if (!hasFailures) {
    console.log("🎉 ALL SYSTEMS ARE OPERATIONAL!");
    console.log("  - The pipeline is fully responsive and fast.");
  }
}

runDiagnostics().catch(err => {
  console.error("Fatal diagnostic runner error:", err);
});
