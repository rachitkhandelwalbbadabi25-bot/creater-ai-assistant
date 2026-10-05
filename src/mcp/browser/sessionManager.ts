// BrowserSessionManager – authoritative browser tab and session lifecycle manager
import { newContext, newPage, closeBrowser } from './browserClient.js';
import { Page, BrowserContext } from 'playwright';
import { v4 as uuidv4 } from 'uuid';

class BrowserSessionManager {
  private tabs: Map<string, { context: BrowserContext; page: Page }> = new Map();
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly IDLE_TIMEOUT_MS = Number(process.env.PLAYWRIGHT_IDLE_TIMEOUT_MS) || 5 * 60 * 1000;

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      console.log('[BROWSER_SESSION_IDLE_AUTO_CLEANUP]');
      this.cleanupAll().catch(() => {});
    }, this.IDLE_TIMEOUT_MS);
  }

  async openTab(): Promise<string> {
    console.log('[OPEN_TAB_START]');
    this.resetIdleTimer();
    const context = await newContext();
    const page = await newPage(context);
    const tabId = uuidv4();
    this.tabs.set(tabId, { context, page });
    console.log('[OPEN_TAB_RETURN]', { tabId });
    return tabId;
  }

  async openPage(): Promise<string> {
    return this.openTab();
  }

  async navigate(tabId: string, url: string): Promise<void> {
    this.resetIdleTimer();
    const page = this.getPage(tabId);
    if (!page) throw new Error(`No active browser page for tab: ${tabId}`);
    console.log(`[PAGE_GOTO] ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  async search(tabId: string, query: string): Promise<void> {
    this.resetIdleTimer();
    const page = this.getPage(tabId);
    if (!page) throw new Error(`No active browser page for tab: ${tabId}`);
    const inputSelector = 'textarea[name="q"], input[name="q"]';
    await page.waitForSelector(inputSelector, { timeout: 10000 });
    await page.fill(inputSelector, query);
    await page.keyboard.press('Enter');
    console.log(`[SEARCH_EXECUTED] ${query}`);
    await page.waitForTimeout(3000);
  }

  async extractText(tabId: string): Promise<string> {
    this.resetIdleTimer();
    const page = this.getPage(tabId);
    if (!page) throw new Error(`No active browser page for tab: ${tabId}`);
    const text = await page.evaluate(() => document.body.innerText);
    console.log('[SUMMARY_EXTRACTED]');
    return text;
  }

  async takeScreenshot(tabId: string, savePath: string, fullPage: boolean = false): Promise<string> {
    this.resetIdleTimer();
    const page = this.getPage(tabId);
    if (!page) throw new Error(`No active browser page for tab: ${tabId}`);
    await page.screenshot({ path: savePath, fullPage });
    console.log(`[SCREENSHOT_SAVED] ${savePath}`);
    return savePath;
  }

  async executeOnPage<T>(fn: (page: Page) => Promise<T>, tabId?: string): Promise<T> {
    let activeTabId = tabId;
    let autoClose = false;

    if (!activeTabId || !this.tabs.has(activeTabId)) {
      activeTabId = await this.openTab();
      autoClose = true;
    }

    try {
      const page = this.getPage(activeTabId)!;
      return await fn(page);
    } finally {
      if (autoClose && activeTabId) {
        await this.closeTab(activeTabId).catch(() => {});
      }
    }
  }

  getPage(tabId: string): Page | undefined {
    const entry = this.tabs.get(tabId);
    return entry?.page;
  }

  async closeTab(tabId: string): Promise<void> {
    const entry = this.tabs.get(tabId);
    if (!entry) return;
    try {
      await entry.page.close();
      await entry.context.close();
    } catch {
      // ignore cleanup errors
    }
    this.tabs.delete(tabId);
  }

  async cleanupAll(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    for (const tabId of Array.from(this.tabs.keys())) {
      await this.closeTab(tabId);
    }
    await closeBrowser();
  }
}

export const browserSessionManager = new BrowserSessionManager();


