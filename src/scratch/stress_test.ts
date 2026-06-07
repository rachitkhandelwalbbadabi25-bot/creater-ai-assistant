import { openLaunchTarget } from "../tools/laptop/launcher";

const commands = [
  "open notepad",
  "screenshot",
  "open calculator",
  "open https://example.com",
  "open notepad",
  "screenshot",
  "open calculator",
  "open https://example.com",
  // repeat to get 50 commands
];

async function run() {
  for (let i = 0; i < 6; i++) {
    for (const cmd of commands) {
      try {
        console.log("Executing", cmd);
        await openLaunchTarget(cmd);
      } catch (e) {
        console.error("Error executing", cmd, e);
      }
    }
  }
  console.log("Stress test completed");
  console.log("Memory usage", process.memoryUsage());
}

run();
