import { newContext, closeBrowser } from '../../src/mcp/browser/browserClient';

(async () => {
  try {
    const ctx = await newContext();
    console.log('context ok');
    await ctx.close();
    await closeBrowser();
    console.log('browser closed');
  } catch (err) {
    console.error('Error:', err);
  }
})();
