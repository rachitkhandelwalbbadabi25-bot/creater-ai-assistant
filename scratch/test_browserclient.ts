import { browserSessionManager } from '../src/mcp/browser/sessionManager';

(async () => {
  try {
    const tabId = await browserSessionManager.openPage();
    console.log('Opened tab:', tabId);
    // Optionally navigate to a site
    await browserSessionManager.navigate(tabId, 'https://example.com');
    const text = await browserSessionManager.extractText(tabId);
    console.log('Extracted text length:', text.length);
    await browserSessionManager.cleanupAll();
    console.log('Cleanup done');
  } catch (e) {
    console.error('Error in test script', e);
  }
})();
