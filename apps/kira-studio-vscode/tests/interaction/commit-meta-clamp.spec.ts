import { expect, test } from '@playwright/test';
import {
  type HarnessServer,
  startCommitMetaHarnessServer,
} from './support/commitMetaHarnessServer.ts';

/**
 * G19 §4.2/D4 (item 4): CommitMeta.vue's message-body clamp — real rendered geometry
 * (`scrollHeight`/`clientHeight`), the same standard this tier's own `webview-layout` project
 * already holds itself to (G16), over a standalone mount rather than the full graph-panel
 * bootstrap (SlickGrid, the layout worker) this one component's own behaviour has no need of.
 */
test.describe('CommitMeta message-body clamp', () => {
  let server: HarnessServer;

  test.beforeAll(async () => {
    server = await startCommitMetaHarnessServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  test('a long body starts clamped, and "Show more" expands it to its full height', async ({
    page,
  }) => {
    await page.goto(server.url);

    const body = page.locator('.kv-meta-body');
    await expect(body).toBeVisible();

    const toggle = page.locator('.kv-meta-body-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText('Show more');

    const collapsed = await body.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(collapsed.clientHeight, 'collapsed: clamped to a bounded height').toBeGreaterThan(0);
    expect(
      collapsed.scrollHeight,
      'collapsed: the full content is taller than the 4-line clamp',
    ).toBeGreaterThan(collapsed.clientHeight);

    await toggle.click();
    await expect(toggle).toHaveText('Show less');

    const expandedHeight = await body.evaluate((el) => el.clientHeight);
    expect(expandedHeight, 'expanded: the clamp is lifted, full content now visible').toBe(
      collapsed.scrollHeight,
    );
  });
});
