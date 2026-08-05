// src/tests/browser.lifecycle.test.ts
import { describe, it, expect, afterEach } from 'bun:test';
import { browserSessionManager } from '../mcp/browser/sessionManager.js';
import { cleanupLaunchedProcesses } from '../mcp/os/osOps.js';

function memoryUsed() {
  return process.memoryUsage().heapUsed;
}

function activeHandles() {
  // @ts-ignore – Node internal API
  return (process as any)._getActiveHandles().length;
}

describe('Browser Lifecycle', () => {
  afterEach(async () => {
    await cleanupLaunchedProcesses();
    await browserSessionManager.cleanupAll();
  });

  it('should open and close tabs repeatedly without leaks', async () => {
    const initialMem = memoryUsed();
    const initialHandles = activeHandles();

    const iterations = 25; // CI iteration count
    for (let i = 0; i < iterations; i++) {
      const tabId = await browserSessionManager.openTab();
      const page = browserSessionManager.getPage(tabId);
      if (!page) throw new Error('Page not found');
      await page.goto('about:blank');
      await browserSessionManager.closeTab(tabId);
    }

    // Cleanup any stray resources
    await browserSessionManager.cleanupAll();

    const finalMem = memoryUsed();
    const finalHandles = activeHandles();

    // Allow a small growth tolerance (<5%)
    const memGrowth = (finalMem - initialMem) / initialMem;
    expect(memGrowth).toBeLessThan(0.05);
    expect(finalHandles).toBeLessThanOrEqual(initialHandles + 2); // a few extra handles are okay
  });
});
