const { chromium } = require('playwright');
const assert = require('assert');
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const errors = [];
  for (const mic of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:8787/top' + (mic ? '?mic=1' : ''));
    const f = page.frameLocator('#f');
    await f.locator('h1.display').waitFor();
    await f.locator('.sidebar a[href="#/notes"]').click();
    await f.locator('h1.display:has-text("Notes")').waitFor();
    const topUrl = page.url();
    assert.ok(!/#/.test(topUrl), 'top page must not navigate: ' + topUrl);
    await f.locator('.sidebar a[href="#/record"]').click();
    await f.locator('[data-act="recStart"]').click();
    if (mic) {
      await f.locator('.rec-dot').waitFor({ timeout: 5000 });
      console.log('  ✓ iframe with allow="microphone": recording starts, in-app links stay inside the frame');
    } else {
      await f.locator('text=The microphone isn\'t available here').waitFor({ timeout: 5000 });
      console.log('  ✓ iframe without mic permission: friendly fallback with upload, links stay inside the frame');
    }
    await ctx.close();
  }
  await browser.close();
  if (errors.length) { console.log(errors); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
