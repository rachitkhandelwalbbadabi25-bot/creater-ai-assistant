import { chromium } from "playwright";

async function runTest() {
  console.log("Starting test...");
  const startLaunch = Date.now();
  try {
    console.log("Calling chromium.launch()...");
    const browser = await chromium.launch({ headless: false, args: ["--no-sandbox"], timeout: 30000 });
    const endLaunch = Date.now();
    console.log(`chromium.launch() succeeded in ${endLaunch - startLaunch}ms`);
    console.log("browser.isConnected():", browser.isConnected());
    
    console.log("Calling browser.newContext()...");
    const startContext = Date.now();
    
    // Set a timeout for newContext to see if it hangs
    const contextPromise = browser.newContext();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("browser.newContext() timeout after 10 seconds")), 10000)
    );
    
    const context = await Promise.race([contextPromise, timeoutPromise]);
    const endContext = Date.now();
    console.log(`browser.newContext() succeeded in ${endContext - startContext}ms`);
    
    await browser.close();
    console.log("Browser closed successfully.");
  } catch (err: any) {
    console.error("Test failed with error:", err.message || err);
  }
}

runTest();
