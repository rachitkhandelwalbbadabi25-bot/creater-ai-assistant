// Scratch script to test executionAgent with browser tasks
import { executionAgent } from "../src/agents/executionAgent.js";
import { browserSessionManager } from "../src/mcp/browser/sessionManager.js";

async function test() {
  const mockContext: any = {
    plannerAgentOutput: {
      steps: [
        "Open browser",
        "Navigate to https://www.google.com",
        "Search \"AI agents\"",
        "Extract summary"
      ]
    }
  };
  const result = await executionAgent(mockContext);
  console.log('Execution Result:', JSON.stringify(result, null, 2));
  // Clean up
  await browserSessionManager.cleanupAll();
}

test().catch(console.error);
