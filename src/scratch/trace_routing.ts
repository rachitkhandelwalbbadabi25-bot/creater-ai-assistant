import { classifyRuntimeMode } from "../runtime/RuntimeModeClassifier.js";
import { routeFastCommand } from "../graph/commandRouter.js";
import { detectIntent as detectSemanticIntent } from "../runtime/semantic/intentDetector.js";
import { routeRequest } from "../llm/router.js";
import { extractQuery } from "../runtime/semantic/queryExtractor.js";

const testInputs = [
  // Conversational Temporal Phrases (MUST BE CONVERSATION)
  "what are you doing now",
  "what are you doing now bro",
  "what should I do now",
  "help me now",
  "what do you think right now",
  "tell me what you are doing",
  "why is this happening now",
  "can you explain this today",

  // Temporal Web Search Requests (MUST BE WEB SEARCH)
  "what is happening in AI right now",
  "what's the latest NVIDIA news",
  "who is the current CEO of Microsoft",
  "what happened in AI today",
  "latest OpenAI news",
  "current Bitcoin price",

  // Existing Routing Actions & Searches
  "search for MCP",
  "look up AI agents",
  "find information about AI",
  "search screenshot folder",
  "open screenshot folder",
  "find screenshot folder",
  "open Documents",
  "open Chrome",
];

async function main() {
  console.log("=== PHASE 1: ROUTING TRACE INVESTIGATION ===\n");

  for (const input of testInputs) {
    console.log(`========================================`);
    console.log(`INPUT: "${input}"`);
    console.log(`========================================`);

    const fastCmd = routeFastCommand(input);
    console.log(`1. routeFastCommand:`, fastCmd);

    const runtimeClass = classifyRuntimeMode(input);
    console.log(`2. RuntimeModeClassifier:`, {
      mode: runtimeClass.mode,
      reason: runtimeClass.reason,
      intent: runtimeClass.intent,
      executionSource: runtimeClass.executionSource,
      targetAgent: runtimeClass.targetAgent,
    });

    const semanticDetect = detectSemanticIntent(input);
    const queryExtract = extractQuery(input);
    console.log(`3. detectSemanticIntent:`, {
      intent: semanticDetect.intent,
      confidence: semanticDetect.confidence,
      extractedQuery: queryExtract?.query,
    });

    const routeRes = await routeRequest(input);
    if (routeRes.ok) {
      console.log(`4. routeRequest (@llm/router):`, {
        intent: routeRes.value.intent.intent,
        agent: routeRes.value.agent,
        model: routeRes.value.model,
      });
    }

    const willWebSearch =
      runtimeClass.intent === "browser_search" ||
      semanticDetect.intent === "browser_search" ||
      (routeRes.ok && routeRes.value.intent.intent === "browser_search");

    console.log(`SUMMARY RESULT FOR "${input}": ${willWebSearch ? "⚠️ WEB SEARCH" : "✅ CONVERSATION / LOCAL ACTION"}\n`);
  }
}

main().catch(console.error);
