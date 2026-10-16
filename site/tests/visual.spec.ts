import { expect, test } from '@playwright/test';

const BASE = '/kira-studio/';

test.skip(process.platform !== 'linux', 'Linux-recorded baseline');

for (const route of [
  { app: 'studio', path: '' },
  { app: 'space', path: 'space/' },
]) {
  test(`${route.app} tab matches the baseline`, async ({ page }) => {
    test.slow();
    await page.goto(`${BASE}${route.path}`);
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight) {
        window.scrollTo({ top: y, behavior: 'instant' });
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      await Promise.all([...document.images].map((img) => img.decode().catch(() => undefined)));
      await document.fonts.ready;
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await expect(page).toHaveScreenshot(`${route.app}.png`, {
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
    });
  });
}
