import { expect, test } from './fixtures';

// Installability: a valid manifest, an active service worker and an offline shell.

test('the manifest links, parses and names the installable icons', async ({
  page,
  app,
  server,
}) => {
  server.state.auth = 'ok';
  await app();
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifest = (await (
    await page.request.get(new URL(href ?? '', server.url).href)
  ).json()) as {
    name: string;
    display: string;
    start_url: string;
    icons: { sizes: string; purpose?: string }[];
  };
  expect(manifest).toMatchObject({
    name: 'Kira Space Agents',
    display: 'standalone',
    start_url: '/',
  });
  const sizes = manifest.icons.map((i) => `${i.sizes}${i.purpose ? `:${i.purpose}` : ''}`);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512', '512x512:maskable']));
});

test('the service worker activates and the shell reloads offline', async ({
  page,
  context,
  app,
  server,
  browserName,
}) => {
  // Playwright's WebKit cannot emulate offline for service-worker-served navigations.
  test.skip(browserName === 'webkit', 'setOffline is unsupported for WebKit navigations');
  server.state.auth = 'ok';
  await app();
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.active) throw new Error('service worker not active');
  });
  // The first load predates the worker's control; a reload gets the precached shell.
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('[data-testid="pair-screen"]')).toBeVisible();
  await expect(page.locator('[data-testid="pair-notice"]')).toContainText(
    'Cannot reach Kira Space',
  );
});
