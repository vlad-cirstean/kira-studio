import { expect, test } from './fixtures';

// The three read-only tabs against the committed ADE fixtures.

const t = (id: string) => `[data-testid="${id}"]`;

test.beforeEach(async ({ app, server }) => {
  server.state.auth = 'ok';
  await app();
});

test('Need You is the landing tab: urgent items first, badge and footer', async ({ page }) => {
  await expect(page.locator(t('needs-screen'))).toBeVisible();
  const kinds = await page
    .locator(t('needs-item'))
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')));
  expect(kinds).toEqual(['failed', 'setup failed', 'stale merge', 'stale merge']);
  await expect(page.locator(t('tab-needs-badge'))).toHaveText('4');
  await expect(page.locator(t('needs-footer'))).toHaveText(
    '10 background runs · 3 interactive sessions',
  );
});

test('Backlog lists items in priority order and expands notes', async ({ page }) => {
  await page.locator(t('tab-backlog')).click();
  await expect(page).toHaveURL(/\/backlog$/);
  const items = page.locator(t('backlog-item'));
  await expect(items).toHaveCount(4);
  await expect(items.first()).toContainText('Rate limit the export endpoint per workspace');
  await expect(items.first()).toContainText('PAY-140');
  await items.first().locator('button').click();
  await expect(page.locator(t('backlog-notes'))).toHaveText('No notes.');
});

test('Plan groups tasks by day and expands a task into its stages', async ({ page }) => {
  await page.locator(t('tab-plan')).click();
  await expect(page).toHaveURL(/\/plan$/);
  const labels = await page.locator(`${t('plan-group')} h2`).allTextContents();
  expect(labels.map((l) => l.trim())).toEqual([
    'Earlier',
    'Today',
    'Tomorrow',
    'Thu, Sep 24',
    'Fri, Sep 25',
    'Mon, Sep 28',
    'Tue, Sep 29',
    'Wed, Sep 30',
    'Later',
  ]);
  const cart = page
    .locator(t('plan-task'))
    .filter({ hasText: 'Cart total test fails intermittently' });
  await expect(cart.locator(t('plan-status'))).toBeVisible();
  await cart.locator('button').first().click();
  await expect(cart.locator(t('plan-stages'))).toBeVisible();
  await expect(cart.locator(t('plan-stages'))).toContainText('Release');
});

test('every tab fits the screen width', async ({ page }) => {
  for (const tab of ['backlog', 'needs', 'plan']) {
    await page.locator(t(`tab-${tab}`)).click();
    await expect(page.locator(t(`${tab}-screen`))).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }
});

test('a board push refetches the board and the app never writes', async ({ page, server }) => {
  const boardReads = () => server.state.requests.filter((r) => r.path === '/api/ade/board').length;
  await expect(page.locator(t('connection-dot'))).toHaveAttribute('title', 'live');
  const before = boardReads();
  server.emit('kira:adetask:board', null);
  await expect.poll(boardReads).toBeGreaterThan(before);
  expect(server.nonGet()).toEqual([]);
});
