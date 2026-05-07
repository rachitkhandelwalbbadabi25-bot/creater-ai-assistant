// ════════════════════════════════════════════════════════════════════════════════
// src/tools/laptop/browser.ts — Browser automation via Playwright
// ════════════════════════════════════════════════════════════════════════════════

import { env } from "@config/index.js";
import { createLogger } from "@utils/logger.js";
import { ToolError } from "@utils/errorHandler.js";

const log = createLogger("tools/browser");

let browserInstance: any = null;

async function getBrowser() {
  if (browserInstance) return browserInstance;
  const { chromium, firefox, webkit } = await import("playwright");
  const browsers = { chromium, firefox, webkit };
  const browserType = browsers[env.PLAYWRIGHT_BROWSER as keyof typeof browsers] ?? chromium;
  browserInstance = await browserType.launch({ headless: env.PLAYWRIGHT_HEADLESS });
  log.info(`Browser launched: ${env.PLAYWRIGHT_BROWSER} (headless=${env.PLAYWRIGHT_HEADLESS})`);
  return browserInstance;
}

export async function navigateToUrl(url: string): Promise<string> {
  log.tool(`Navigating to: ${url}`);
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  const title = await page.title();
  await page.close();
  return title;
}

export async function extractText(url: string): Promise<string> {
  log.tool(`Extracting text from: ${url}`);
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  const text = await page.evaluate(() => document.body.innerText);
  await page.close();
  return (text as string).slice(0, 5000); // Cap at 5k chars
}

export async function takeScreenshot(url: string, savePath: string): Promise<string> {
  log.tool(`Screenshot: ${url} → ${savePath}`);
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.screenshot({ path: savePath, fullPage: false });
  await page.close();
  return savePath;
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
    log.info("Browser closed");
  }
}
