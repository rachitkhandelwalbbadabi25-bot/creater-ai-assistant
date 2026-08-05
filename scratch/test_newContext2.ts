import { newContext, closeBrowser } from '../src/mcp/browser/browserClient';

(async () => {
  try {
    console.log('Calling newContext');
    const ctx = await newContext();
    console.log('newContext returned');
    await ctx.close();
    await closeBrowser();
    console.log('browser closed');
  } catch (err) {
    console.error('Error during test:', err);
  }
})();
