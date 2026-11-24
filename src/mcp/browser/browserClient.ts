// Browser MCP client – singleton Playwright browser instance with CDP support
import { chromium, firefox, webkit, Browser, BrowserContext, Page } from 'playwright';
import { env } from '../../config/index.js';

let browserInstance: Browser | null = null;
let launchInProgress: Promise<Browser> | null = null;
let cdpConnected = false;

export function isCDPConnected(): boolean {
  return cdpConnected;
}

export async function isCDPAvailable(port = 9222): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(400),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { webSocketDebuggerUrl?: string };
    return Boolean(data?.webSocketDebuggerUrl);
  } catch {
    return false;
  }
}

export async function ensureChromeCDP(port = 9222): Promise<boolean> {
  return await isCDPAvailable(port);
}

export async function getBrowser(options?: { preferCDP?: boolean }): Promise<Browser> {
  const cdpPort = Number(process.env.CHROME_CDP_PORT) || 9222;

  if (browserInstance && browserInstance.isConnected()) {
    if (!options?.preferCDP || cdpConnected) {
      return browserInstance;
    }
    const canUpgradeToCDP = (await isCDPAvailable(cdpPort)) || (await ensureChromeCDP(cdpPort));
    if (!canUpgradeToCDP) {
      return browserInstance;
    }
    await browserInstance.close().catch(() => {});
    browserInstance = null;
    cdpConnected = false;
  }

  if (launchInProgress) {
    return launchInProgress;
  }

  launchInProgress = (async (): Promise<Browser> => {
    try {
      // 1. Check if user's Chrome is running with Remote Debugging (CDP), or launch it when preferCDP/headed
      let cdpActive = await isCDPAvailable(cdpPort);
      if (!cdpActive && (options?.preferCDP || env.PLAYWRIGHT_HEADLESS === false)) {
        cdpActive = await ensureChromeCDP(cdpPort);
      }

      if (cdpActive) {
        console.log(`[BROWSER_CDP_ATTACH] Connecting to existing Chrome session at 127.0.0.1:${cdpPort}...`);
        browserInstance = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, {
          timeout: 3000,
          noDefaults: true,
        });
        cdpConnected = true;
        browserInstance.on('disconnected', () => {
          console.log('[BROWSER_CDP_DISCONNECTED]');
          browserInstance = null;
          cdpConnected = false;
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
      cdpConnected = false;

      browserInstance.on('disconnected', () => {
        console.log('[BROWSER_DISCONNECTED]');
        browserInstance = null;
        cdpConnected = false;
      });

      console.log('[BROWSER_LAUNCH_SUCCESS]');
      return browserInstance;
    } catch (err) {
      console.log('[BROWSER_LAUNCH_FAILED]', err);
      browserInstance = null;
      cdpConnected = false;
      throw err;
    } finally {
      launchInProgress = null;
    }
  })();

  return launchInProgress;
}

export async function newContext(options?: { preferCDP?: boolean }): Promise<BrowserContext> {
  const browser = await getBrowser(options);
  if (cdpConnected && browser.contexts().length > 0) {
    return browser.contexts()[0]!;
  }
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
    cdpConnected = false;
  }
}

