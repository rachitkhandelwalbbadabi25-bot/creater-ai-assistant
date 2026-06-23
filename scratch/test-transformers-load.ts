import { pipeline, env } from "@xenova/transformers";

console.log("--- Standalone Transformer Load Test ---");
console.log("Bun version:", process.versions?.bun);
console.log("Node version:", process.versions?.node);
console.log("Process platform:", process.platform);

try {
  console.log("require.resolve @xenova/transformers:", require.resolve("@xenova/transformers"));
} catch (e) {
  console.error("resolve error @xenova/transformers", e);
}
try {
  console.log("require.resolve onnxruntime-web:", require.resolve("onnxruntime-web"));
} catch (e) {
  console.error("resolve error onnxruntime-web", e);
}
try {
  console.log("require.resolve onnxruntime-node:", require.resolve("onnxruntime-node"));
} catch (e) {
  console.error("resolve error onnnxruntime-node", e);
}

console.log("env.backends before any pipeline:", JSON.stringify(env?.backends, null, 2));

(async () => {
  try {
    const model = await pipeline(
      "text-classification",
      "SamLowe/roberta-base-go_emotions",
      { quantized: true }
    );
    console.log("Pipeline loaded successfully");
    console.log("env.backends after pipeline:", JSON.stringify(env?.backends, null, 2));
    // Test a simple inference
    const res = await model("I am happy");
    console.log("Inference result:", res);
  } catch (err) {
    console.error("Error loading pipeline or inference:", err);
  }
})();
