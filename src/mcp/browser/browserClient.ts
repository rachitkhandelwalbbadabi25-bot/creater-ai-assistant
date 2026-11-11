// Browser MCP client – singleton Playwright browser instance with CDP support
import { chromium, firefox, webkit, Browser, BrowserContext, Page } from 'playwright';
import { env } from '../../config/index.js';

let browserInstance: Browser | null = null;
let launchInProgress: Promise<Browser> | null = null;

export async function isCDPAvailable(port = 9222): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(400),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }
  if (launchInProgress) {
    return launchInProgress;
  }

  launchInProgress = (async () => {
    try {
      // 1. Check if user's Chrome is running with Remote Debugging (CDP)
      const cdpPort = Number(process.env.CHROME_CDP_PORT) || 9222;
      const cdpActive = await isCDPAvailable(cdpPort);
      if (cdpActive) {
        console.log(`[BROWSER_CDP_ATTACH] Connecting to existing Chrome session at 127.0.0.1:${cdpPort}...`);
        browserInstance = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
        browserInstance.on('disconnected', () => {
          console.log('[BROWSER_CDP_DISCONNECTED]');
          browserInstance = null;
        });
        console.log('[BROWSER_CDP_ATTACH_SUCCESS]');
        return browserInstance;
      }

      // 2. Standard Playwright launch
      const browserTypes = { chromium, firefox, webkit };
      const browserType = browserTypes[env.PLAYWRIGHT_BROWSER as keyof typeof browserTypes] ?? chromium;
      const headless = env.PLAYWRIGHT_HEADLESS !== false;

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

