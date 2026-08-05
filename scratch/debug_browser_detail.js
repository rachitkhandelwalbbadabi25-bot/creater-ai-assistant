// debug_browser_detail.js - investigate Playwright Chromium launch\nconst { chromium } = require('playwright');\n\n(async () => {
  try {
    console.log('Executable Path:', chromium.executablePath());
  } catch (e) {
    console.error('Error getting executablePath:', e);
  }
  try {
    const launchOptions = { headless: false, args: ['--no-sandbox'], timeout: 30000 };
    console.log('Launching with options:', launchOptions);
    const browser = await chromium.launch(launchOptions);
    console.log('Launch succeeded');
    console.log('Browser version:', await browser.version());
    const context = await browser.newContext();
    console.log('newContext succeeded');
    const page = await context.newPage();
    console.log('newPage succeeded');
    await page.goto('https://example.com', { timeout: 30000 });
    console.log('page.goto succeeded');
    await browser.close();
    console.log('Browser closed');
  } catch (e) {
    console.error('Error during launch sequence:', e);
  }
})();
