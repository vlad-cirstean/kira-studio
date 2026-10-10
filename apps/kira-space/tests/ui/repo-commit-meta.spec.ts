import { expect, test } from './fixtures';
import { openCommitDetail } from './support/gitUiPortFixtures';

// The commit detail pane's collapsed and expanded states inside Space, over real rendered
// geometry. Ported from the VS Code webview suite.

test('collapsed, the pane shows the title, a short SHA and Open all changes, and nothing else', async ({
  relaunch,
}) => {
  const page = await openCommitDetail(relaunch);

  await expect(page.locator('[data-testid="open-all-changes-button"]')).toBeVisible();
  await expect(page.locator('[data-testid="commit-meta-sha"]')).toHaveText('2222222');
  await expect(page.locator('[data-testid="meta-body-toggle"]')).toHaveText('Show more');
  await expect(page.locator('[data-testid="meta-body"]')).toBeHidden();
  await expect(page.locator('[data-testid="meta-trailers"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="meta-identity"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="meta-refs"]')).toHaveCount(0);
  await expect(
    page.locator(
      '[data-testid="meta-sha-row"], [data-testid="meta-parents"], [data-testid="meta-parent"]',
    ),
  ).toHaveCount(0);

  const { pane, tree } = await page.evaluate(() => {
    const height = (sel: string) =>
      document.querySelector(sel)?.getBoundingClientRect().height ?? 0;
    return {
      pane: height('[data-testid="detail-pane"]'),
      tree: height('[data-testid="detail-pane-tree"]'),
    };
  });
  expect(pane).toBeGreaterThan(0);
  expect(tree / pane).toBeGreaterThanOrEqual(0.75);
});

test('Show more reveals the full body, trailers, identities and refs, and the pane scrolls', async ({
  relaunch,
}) => {
  const page = await openCommitDetail(relaunch);
  const meta = page.locator('[data-testid="commit-meta"]');
  const collapsedHeight = await meta.evaluate((el) => el.clientHeight);

  const toggle = page.locator('[data-testid="meta-body-toggle"]');
  await toggle.click();
  await expect(toggle).toHaveText('Show less');

  const body = page.locator('[data-testid="meta-body"]');
  await expect(body).toBeVisible();
  const { scrollHeight, clientHeight } = await body.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(clientHeight).toBe(scrollHeight);

  const trailers = page.locator('[data-testid="meta-trailers"]');
  await expect(trailers).toContainText('Co-authored-by');
  await expect(trailers).toContainText('Jane Coauthor');
  await expect(trailers).toContainText('Signed-off-by');
  const identity = page.locator('[data-testid="meta-identity"]');
  await expect(identity).toHaveCount(2);
  await expect(identity.first()).toContainText('Fake Author');
  await expect(identity.last()).toContainText('Fake Committer');
  await expect(page.locator('dt', { hasText: 'Refs' })).toBeVisible();
  await expect(page.locator('[data-testid="meta-refs"]')).toContainText('main');
  await expect(page.locator('[data-testid="commit-meta-sha"]')).toHaveText('2222222');

  const expanded = await meta.evaluate((el) => ({
    height: el.clientHeight,
    overflowY: getComputedStyle(el).overflowY,
  }));
  expect(expanded.height).toBeGreaterThan(collapsedHeight);
  expect(expanded.overflowY).toBe('auto');
});
