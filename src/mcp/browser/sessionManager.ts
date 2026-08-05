// BrowserSessionManager – manages tab IDs and pages
import { newContext, newPage, getBrowser, closeBrowser } from './browserClient';
import { Page, BrowserContext } from 'playwright';
import { v4 as uuidv4 } from 'uuid';

class BrowserSessionManager {
  private tabs: Map<string, { context: BrowserContext; page: Page }> = new Map();

  async openTab(): Promise<string> {
    console.log("[OPEN_TAB_START]");
    const context = await newContext();
    const page = await newPage(context);
    const tabId = uuidv4();
    this.tabs.set(tabId, { context, page });
    console.log("[OPEN_TAB_RETURN]");
    return tabId;
  }

  async openPage(): Promise<string> {
    console.log("[BROWSER_CLIENT_CREATED]");
    console.log("[PLAYWRIGHT_LAUNCHED]");
    return this.openTab();
  }

  async navigate(tabId: string, url: string): Promise<void> {
    const page = this.getPage(tabId);
    if (!page) throw new Error(`No page for tab: ${tabId}`);
    console.log(`[PAGE_GOTO] ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  async search(tabId: string, query: string): Promise<void> {
    const page = this.getPage(tabId);
    if (!page) throw new Error(`No page for tab: ${tabId}`);
    // Support Google search input selector
    // Wait for the input field to be present
    const inputSelector = 'textarea[name="q"], input[name="q"]';
    await page.waitForSelector(inputSelector, { timeout: 10000 });
    await page.fill(inputSelector, query);
    await page.keyboard.press('Enter');
    console.log(`[SEARCH_EXECUTED] ${query}`);
    // Wait for search results container/page load
    await page.waitForTimeout(3000);
  }

  async extractText(tabId: string): Promise<string> {
    const page = this.getPage(tabId);
    if (!page) throw new Error(`No page for tab: ${tabId}`);
    const text = await page.evaluate(() => document.body.innerText);
    console.log("[SUMMARY_EXTRACTED]");
    return text;
  }

  getPage(tabId: string): Page | undefined {
    const entry = this.tabs.get(tabId);
    return entry?.page;
  }

  async closeTab(tabId: string): Promise<void> {
    const entry = this.tabs.get(tabId);
    if (!entry) return;
    await entry.page.close();
    await entry.context.close();
    this.tabs.delete(tabId);
  }

  async cleanupAll(): Promise<void> {
    for (const tabId of this.tabs.keys()) {
      await this.closeTab(tabId);
    }
    await closeBrowser();
  }
}

export const browserSessionManager = new BrowserSessionManager();

