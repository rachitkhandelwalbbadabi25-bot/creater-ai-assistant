import { processMessageStreaming } from "c:/Users/dell/OneDrive/Desktop/personal ai assistant/src/graph/supervisor.ts";

async function test() {
  console.log("Starting chitchat verification test...");
  try {
    let responseReceived = "";
    const result = await processMessageStreaming("hello bro how are you", "web", (text: string) => {
      responseReceived += text;
      process.stdout.write(text);
    });
    console.log("\nFinal processMessageStreaming returned result:", result);

    // Wait a couple of seconds to see if background embeddings run
    await new Promise((resolve) => setTimeout(resolve, 3000));
  } catch (err) {
    console.error("Test failed with error:", err);
  }
}

test();
