import { expect, test } from '@playwright/test';
import { type LayoutServer, startLayoutServer } from './support/server.ts';

// G16's own guard: G14 shipped a webview panel that instantiated — its `aria-rowcount` matched
// the real commit count — while visually collapsed to a ~75px strip inside a 360px panel, because
// nothing in the emitted document or the bundled CSS ever gave `html`/`body`/`#app` a real
// height. That check passed on DOM shape while the panel was destroyed. This tier asserts pixels
// instead: `getBoundingClientRect()` against the viewport, against the real document
// `buildWebviewDocument` produces (the same template `renderHtml` emits for the real extension
// host) and the real built bundle, with no `!important`/proxy shortcuts anywhere in between.
//
// What this deliberately cannot cover without a real backend: rendered row counts,
// `.slick-viewport`'s own height, or anything else that needs data flowing through a transport.
// Asserting those here against a dead transport would be the same mistake as G14's own
// `aria-rowcount` check — a proxy that can pass while the thing it stands in for is broken. See
// `docs/v1.3/plans/G16-webview-layout-collapse.md` §9 for what a later, mocked-transport tier
// could add on top of this one.

test.describe('webview layout', () => {
  let server: LayoutServer;

  test.beforeAll(async () => {
    server = await startLayoutServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  async function bootPage(
    page: import('@playwright/test').Page,
  ): Promise<{ pageErrors: Error[]; consoleErrors: string[] }> {
    const pageErrors: Error[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    // F9: measured to survive the document's real CSP (`default-src 'none'; script-src
    // 'nonce-…'`) — installed via CDP, not as a page script, so no nonce plumbing is needed here.
    await page.addInitScript(() => {
      let state: unknown;
      // biome-ignore lint/suspicious/noExplicitAny: acquireVsCodeApi is a VS Code webview global, not something this test's own types model.
      (window as any).acquireVsCodeApi = () => ({
        getState: () => state,
        setState: (next: unknown) => {
          state = next;
        },
        postMessage: () => {},
      });
    });
    return { pageErrors, consoleErrors };
  }

  for (const { title, viewport } of [
    { title: 'graph panel at 1400×360', viewport: { width: 1400, height: 360 } },
    {
      title: 'graph panel at 400×300 (no generous viewport assumed)',
      viewport: { width: 400, height: 300 },
    },
  ]) {
    test(title, async ({ page }) => {
      const { pageErrors, consoleErrors } = await bootPage(page);
      await page.setViewportSize(viewport);
      await page.goto(`${server.url}/graph`);

      const root = page.locator('.kv-app');
      await expect(root).toBeVisible();
      const box = await root.boundingBox();
      if (!box) throw new Error('.kv-app has no box');

      expect(box.x, 'root x (F2: the 20px gutter)').toBe(0);
      expect(box.width, 'root width (F2)').toBe(viewport.width);
      expect(box.height, 'root height (F1: the height chain)').toBe(viewport.height);

      const bodyPadding = await page.evaluate(() => getComputedStyle(document.body).padding);
      expect(bodyPadding, 'body padding (F2, directly)').toBe('0px');

      const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      expect(
        scrollHeight,
        'document scrollHeight must not exceed the viewport (the whole-document-scroll failure mode)',
      ).toBeLessThanOrEqual(viewport.height);

      expect(
        pageErrors,
        `page errors: ${pageErrors.map((e) => e.message).join('; ')}`,
      ).toHaveLength(0);
      expect(consoleErrors, `console errors: ${consoleErrors.join('; ')}`).toHaveLength(0);
    });
  }

  test('review sidebar at 400×700', async ({ page }) => {
    const { pageErrors, consoleErrors } = await bootPage(page);
    const viewport = { width: 400, height: 700 };
    await page.setViewportSize(viewport);
    await page.goto(`${server.url}/review`);

    const root = page.locator('.kv-review-view');
    await expect(root).toBeVisible();
    const box = await root.boundingBox();
    if (!box) throw new Error('.kv-review-view has no box');

    expect(box.x, 'root x (F2: the 20px gutter)').toBe(0);
    expect(box.width, 'root width (F2)').toBe(viewport.width);
    expect(box.height, 'root height (F1: the height chain)').toBe(viewport.height);

    const bodyPadding = await page.evaluate(() => getComputedStyle(document.body).padding);
    expect(bodyPadding, 'body padding (F2, directly)').toBe('0px');

    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(
      scrollHeight,
      'document scrollHeight must not exceed the viewport (the whole-document-scroll failure mode)',
    ).toBeLessThanOrEqual(viewport.height);

    expect(pageErrors, `page errors: ${pageErrors.map((e) => e.message).join('; ')}`).toHaveLength(
      0,
    );
    expect(consoleErrors, `console errors: ${consoleErrors.join('; ')}`).toHaveLength(0);
  });
});
