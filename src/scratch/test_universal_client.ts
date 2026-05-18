// src/scratch/test_universal_client.ts

import { getProviderForModel, AvailableModels, Models } from "../config/models.js";
import { env } from "../config/index.js";

console.log("=== Dynamic Model Resolution Tests ===");

const testModels = [
  "gpt-4o",
  "gpt-4o-mini",
  "claude-3-5-sonnet-20241022",
  "gemini-1.5-pro",
  "grok-beta",
  "deepseek-chat",
  "deepseek-coder",
  "qwen2.5:7b",
  "llama3.1:latest",
  "custom-claude-override",
  "my-openai-compatible-model"
];

for (const model of testModels) {
  const provider = getProviderForModel(model);
  console.log(`Model: "${model}" -> resolved provider: [${provider.toUpperCase()}]`);
}

console.log("\n=== Active Model Tiers under current .env configuration ===");
console.log(`LLM_PROVIDER: "${env.LLM_PROVIDER}"`);
console.log(`Models.PRIMARY: "${Models.PRIMARY}"`);
console.log(`Models.FAST: "${Models.FAST}"`);
console.log(`Models.CODER: "${Models.CODER}"`);
console.log(`Models.EMBED: "${Models.EMBED}"`);

console.log("\n=== Done ===");
