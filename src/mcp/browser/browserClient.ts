// Browser MCP client – singleton Playwright browser instance
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { env } from '../../config/index.js';

let browserInstance: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  console.log("[BROWSER_GET_START]");
  if (!browserInstance) {
    // Explicitly launch full Chromium (non‑headless) on Windows to avoid headless‑shell timeout
    // Ignore PLAYWRIGHT_HEADLESS env for this debug scenario and enforce headless: false
    browserInstance = await chromium.launch({ headless: false, args: ['--no-sandbox'], timeout: 0 });
    try { browserInstance.on("disconnected", () => console.log("[BROWSER_DISCONNECTED]")); } catch (e) {}
    try { browserInstance.on("close", () => console.log("[BROWSER_CLOSE]")); } catch (e) {}
    try { (browserInstance as any).on("crash", () => console.log("[BROWSER_CRASH]")); } catch (e) {}
  }
  console.log("[BROWSER_GET_RETURN]");
  return browserInstance;
}

export async function newContext(): Promise<BrowserContext> {
  console.log("[NEW_CONTEXT_START]");
  try {
    const browser = await getBrowser();
    console.log("[BEFORE_NEW_CONTEXT]", {
        browserConnected: browser.isConnected(),
        browserType: browser.browserType().name(),
        pid: browser.process()?.pid,
        browserObject: !!browser
    });
    const start = Date.now();
    try {
        console.log("[NEW_CONTEXT_CALL]");
        const context = await browser.newContext();
        console.log("[NEW_CONTEXT_RETURN]", {
            duration: Date.now() - start
        });
        return context;
    }
    catch (err) {
        console.log("[NEW_CONTEXT_THROW]", err);
        throw err;
    }
  } catch (e: any) {
    console.log("[NEW_CONTEXT_THROW]", e.message || e);
    throw e;
  }
}

export async function newPage(context: BrowserContext): Promise<Page> {
  return await context.newPage();
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}
