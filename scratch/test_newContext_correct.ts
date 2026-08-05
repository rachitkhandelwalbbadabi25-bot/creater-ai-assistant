import path from 'path';
import { newContext, closeBrowser } from path.join(__dirname, '..', 'src', 'mcp', 'browser', 'browserClient');

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
