import { routeFastCommand } from "../graph/commandRouter.js";
import { playYouTube } from "../tools/laptop/computer.js";

async function main() {
  const input = "play first video which you see on youtube of hustle 5";
  console.log(`Parsing command: "${input}"...`);
  const route = routeFastCommand(input);
  console.log("Parsed Route:", JSON.stringify(route, null, 2));

  if (route && route.kind === "youtube" && route.query) {
    console.log(`Executing playYouTube with query="${route.query}", action="${route.action}", selection="${route.selection}"...`);
    const result = await playYouTube(route.query, route.action, route.selection);
    console.log("Execution Result:", result);
  } else {
    console.error("Failed to route command!");
  }
}

main();
