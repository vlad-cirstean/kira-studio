import { expect, test } from '@playwright/test';
import { buildFakeGraphHostInitScript } from './support/fakeGraphHost.ts';
import { type InteractionServer, startInteractionServer } from './support/server.ts';

/** P173: the failure banner and auto-fetch marker in the VS Code webview. The webview is
 *  read-only (no remote ops), so the failure source here is a corrupted graph stream. No
 *  Operations dock in this host: the banner points at Kira Space in text instead. */
test.describe('failure banner and auto-fetch marker (P173)', () => {
  let server: InteractionServer;

  test.beforeAll(async () => {
    server = await startInteractionServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  test('a corrupted graph stream shows a styled banner, text pointer, no Operations button', async ({
    page,
  }) => {
    await page.addInitScript(
      buildFakeGraphHostInitScript({ streamMode: 'corrupted', withFailures: true }),
    );
    await page.goto(`${server.url}/graph`);

    const banner = page.locator('[data-testid="failure-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).not.toHaveAttribute('role', 'alert');
    await expect(page.locator('[data-testid="failure-banner-hint"]')).toContainText(
      'Details: Kira Space → Operations.',
    );
    await expect(page.locator('[data-testid="failure-banner-operations"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="failure-banner-retry"]')).toBeVisible();
    await expect(page.locator('[data-testid="live-announcements"]').first()).not.toHaveText('');

    // Alert utilities must resolve in this bundle: a missed Tailwind source scan leaves them unstyled.
    expect(await banner.evaluate((el) => getComputedStyle(el).borderBottomWidth)).not.toBe('0px');
    expect(await banner.evaluate((el) => getComputedStyle(el).display)).toBe('grid');

    await page.locator('[data-testid="failure-banner-dismiss"]').click();
    await expect(banner).toHaveCount(0);
  });

  test('autoFetch.changed shows the stopped marker', async ({ page }) => {
    await page.addInitScript(buildFakeGraphHostInitScript({ withFailures: true }));
    await page.goto(`${server.url}/graph`);

    await expect(page.locator('[data-testid="repo-settings-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="autofetch-stopped"]')).toHaveCount(0);
    await page.evaluate(() => {
      (window as unknown as { __emitAutoFetchStopped: () => void }).__emitAutoFetchStopped();
    });
    await expect(page.locator('[data-testid="autofetch-stopped"]')).toBeVisible();
  });
});
