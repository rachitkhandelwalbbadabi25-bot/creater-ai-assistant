// Browser MCP client – singleton Playwright browser instance
import { chromium, firefox, webkit, Browser, BrowserContext, Page } from 'playwright';
import { env } from '../../config/index.js';

let browserInstance: Browser | null = null;
let launchInProgress: Promise<Browser> | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }
  if (launchInProgress) {
    return launchInProgress;
  }

  launchInProgress = (async () => {
    try {
      const browserTypes = { chromium, firefox, webkit };
      const browserType = browserTypes[env.PLAYWRIGHT_BROWSER as keyof typeof browserTypes] ?? chromium;
      const headless = env.PLAYWRIGHT_HEADLESS !== false; // default headless mode unless explicitly false

      console.log(`[BROWSER_LAUNCH_START] browser=${env.PLAYWRIGHT_BROWSER || 'chromium'}, headless=${headless}`);
      browserInstance = await browserType.launch({
        headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      browserInstance.on('disconnected', () => {
        console.log('[BROWSER_DISCONNECTED]');
        browserInstance = null;
      });

      console.log('[BROWSER_LAUNCH_SUCCESS]');
      return browserInstance;
    } catch (err) {
      console.log('[BROWSER_LAUNCH_FAILED]', err);
      browserInstance = null;
      throw err;
    } finally {
      launchInProgress = null;
    }
  })();

  return launchInProgress;
}

export async function newContext(): Promise<BrowserContext> {
  const browser = await getBrowser();
  return await browser.newContext();
}

export async function newPage(context: BrowserContext): Promise<Page> {
  return await context.newPage();
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch {
      // ignore if already closed
    }
    browserInstance = null;
  }
}

