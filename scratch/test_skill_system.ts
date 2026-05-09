// ════════════════════════════════════════════════════════════════════════════════
// scratch/test_skill_system.ts — Testing skill loading, suggestion and execution
// ════════════════════════════════════════════════════════════════════════════════

import { loadAllSkills, findMatchingSkill } from "../src/skills/manager.js";
import { suggestSkill } from "../src/skills/generator.js";
import { skillAgentNode } from "../src/graph/skillAgent.js";
import { createInitialState } from "../src/graph/state.js";

async function runTest() {
  console.log("🧪 Starting Skill System Testing...\n");

  // 1. Test Manager Loading
  console.log("--- 1. Testing Skill Manager ---");
  const skills = loadAllSkills();
  console.log(`Loaded ${skills.length} skills:`);
  skills.forEach(s => console.log(`  • ${s.name} (triggers: ${s.triggers.join(", ")})`));

  const matched = findMatchingSkill("Please run test skill for me");
  console.log(`Matched skill for 'run test skill': ${matched?.name || "NONE"}`);

  // 2. Test Skill Generator
  console.log("\n--- 2. Testing Skill Generator ---");
  const suggestion = await suggestSkill("The user often asks to list files in the src directory and then run tests.");
  if (suggestion) {
    console.log("Suggested Skill:");
    console.log(`  Name: ${suggestion.name}`);
    console.log(`  Description: ${suggestion.description}`);
    console.log(`  Steps: ${suggestion.steps.join(" -> ")}`);
  }

  // 3. Test Skill Execution (via SkillAgent)
  console.log("\n--- 3. Testing Skill Execution ---");
  if (matched) {
    const initialState = createInitialState("run test skill", "tui");
    const finalState = await skillAgentNode(initialState);
    console.log("Execution Result:");
    console.log(finalState.output);
  }

  console.log("\n🏁 Skill System Test Completed.");
}

runTest().catch(console.error);
