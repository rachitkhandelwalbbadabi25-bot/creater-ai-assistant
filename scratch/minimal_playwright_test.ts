import { chromium } from "playwright";

async function run() {
  const browser = await chromium.launch({ headless: false, args: ["--no-sandbox"], timeout: 0 });
  console.log("launch ok");
  console.log(browser.isConnected());
  const context = await browser.newContext();
  console.log("context ok");
  await context.close();
  await browser.close();
}

run().catch(console.error);
