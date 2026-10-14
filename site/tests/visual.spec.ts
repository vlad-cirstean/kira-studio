import { expect, test } from '@playwright/test';

const BASE = '/kira-studio/';

test.skip(process.platform !== 'linux', 'Linux-recorded baseline');

for (const route of [
  { app: 'studio', path: '' },
  { app: 'space', path: 'space/' },
]) {
  test(`${route.app} tab matches the baseline`, async ({ page }) => {
    await page.goto(`${BASE}${route.path}`);
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight / 2) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      await Promise.all([...document.images].map((img) => img.decode().catch(() => undefined)));
      await document.fonts.ready;
      window.scrollTo(0, 0);
    });
    await expect(page).toHaveScreenshot(`${route.app}.png`, {
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
    });
  });
}
