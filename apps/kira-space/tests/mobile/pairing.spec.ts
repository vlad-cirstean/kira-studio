import { expect, test } from './fixtures';

// Pairing from a fresh phone: request, the match code, and the four ways it can end.

const t = (id: string) => `[data-testid="${id}"]`;

test('an unpaired phone shows the pairing screen with a request button', async ({ page, app }) => {
  await app();
  await expect(page.locator(t('pair-screen'))).toBeVisible();
  await expect(page.locator(t('pair-request'))).toBeEnabled();
  await expect(page).toHaveURL(/\/pair$/);
});

test('requesting access shows a 4-digit code and the same code is sent to the computer', async ({
  page,
  app,
  server,
}) => {
  await app();
  await page.locator(t('pair-label')).fill('Vlad iPhone');
  await page.locator(t('pair-request')).click();
  const code = (await page.locator(t('pair-code')).textContent())?.trim() ?? '';
  expect(code).toMatch(/^\d{4}$/);
  await expect
    .poll(() => server.state.requests.find((r) => r.path === '/api/pair')?.body)
    .toBeTruthy();
  const sent = JSON.parse(server.state.requests.find((r) => r.path === '/api/pair')?.body ?? '{}');
  expect(sent).toEqual({ label: 'Vlad iPhone', code });
});

test('approval lands on the app and shows the three tabs', async ({ page, app, server }) => {
  await app();
  await page.locator(t('pair-request')).click();
  await expect(page.locator(t('pair-waiting'))).toBeVisible();
  server.resolvePair('approve');
  await expect(page.locator(t('app-shell'))).toBeVisible();
  await expect(page).toHaveURL(/\/needs$/);
  for (const tab of ['backlog', 'needs', 'plan'])
    await expect(page.locator(t(`tab-${tab}`))).toBeVisible();
});

test('a denied request says so and allows another try', async ({ page, app, server }) => {
  await app();
  await page.locator(t('pair-request')).click();
  await expect(page.locator(t('pair-waiting'))).toBeVisible();
  server.resolvePair('deny');
  await expect(page.locator(t('pair-notice'))).toContainText('denied');
  await expect(page.locator(t('pair-request'))).toBeEnabled();
});

test('a timed-out request says nobody answered', async ({ page, app, server }) => {
  await app();
  await page.locator(t('pair-request')).click();
  await expect(page.locator(t('pair-waiting'))).toBeVisible();
  server.resolvePair('timeout');
  await expect(page.locator(t('pair-notice'))).toContainText('Nobody answered');
});

test('a revoked device returns to the pairing screen', async ({ page, app, server }) => {
  server.state.auth = 'ok';
  await app();
  await expect(page.locator(t('app-shell'))).toBeVisible();
  server.state.auth = 'revoked';
  await page.locator(t('refresh')).click();
  await expect(page.locator(t('pair-screen'))).toBeVisible();
  await expect(page.locator(t('pair-notice'))).toContainText('removed in Kira Space');
});
