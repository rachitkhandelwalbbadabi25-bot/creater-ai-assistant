import { classifyRuntimeMode } from "./src/runtime/RuntimeModeClassifier.js";
import { mapIntentToSpec } from "./src/runtime/semantic/runtimeBridge.js";
import { dispatchTool } from "./src/tools/dispatcher.js";
import { RuntimeCommand } from "./src/runtime/runtimeCommand.js";
import { RuntimeRouteEnum } from "./src/runtime/semantic/routeTypes.js";

async function runInput(input: string) {
  console.log(`\n=== Input: ${input} ===`);
  // Classify runtime mode (includes intent detection)
  const classification = classifyRuntimeMode(input);
  console.log("RuntimeModeClassifier result:", classification);

  // Build semantic payload (simplified – using classification fields)
  const payload = {
    originalInput: input,
    intent: classification.intent ?? "UNKNOWN",
    confidence: classification.confidence,
    query: (classification as any).query,
    target: (classification as any).target,
  } as any;

  console.log("IntentDetector result (intent/confidence):", payload.intent, payload.confidence);

  // Route selection
  const spec = mapIntentToSpec(payload);
  console.log("Router intent (route):", spec.route);
  console.log("RuntimeBridge command:", spec.command, spec.args);

  // Dispatch to appropriate tool
  let toolResult: any;
  try {
    toolResult = await dispatchTool(spec.command as unknown as string, spec.args ?? {});
  } catch (e) {
    toolResult = { error: e };
  }
  console.log("Dispatcher result:", toolResult);
}

async function main() {
  const inputs = ["hello bro", "how are you", "hey creator", "good morning"];
  for (const i of inputs) {
    await runInput(i);
  }
}

main().catch((e) => console.error(e));
