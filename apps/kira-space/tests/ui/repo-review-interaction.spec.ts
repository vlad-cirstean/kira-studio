import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { gitStreamParams } from './support/gitStreamMock';
import {
  manyRowShas,
  manyRows,
  oneChunk,
  openPortGraph,
  openReviewListing,
  PICKER_RESULTS,
  REVIEW_FILE_FULL,
  REVIEW_FILE_NONE,
  REVIEW_FILE_PARTIAL,
  REVIEW_RESULTS,
  rootRow,
  SHA_A,
  singleRowChunks,
} from './support/gitUiPortFixtures';

// The review sidebar inside Space: row gestures, host-answered actions, the Files pane checkbox and
// the commit-list render cap. Ported from the VS Code webview suite.

const reviewRow = (p: Page, sha = SHA_A) => p.locator(`[data-testid="review-row-${sha}"]`);
const tabOfKind = (p: Page, kind: string) =>
  p.locator(`[data-testid="tab-strip-wrapper"] [data-testid="tab"][data-tab-kind="${kind}"]`);
const base = (name: string) => name.split('/').pop();

test('clicking a file inside an expanded commit does not collapse the row', async ({
  relaunch,
}) => {
  const page = await openReviewListing(relaunch);
  const row = reviewRow(page);
  await row.locator('.kv-review-row-header').click();
  await expect(row).toHaveAttribute('aria-expanded', 'true');

  await row.locator('.kv-file-tree-row', { hasText: 'example.ts' }).click();

  await expect(row).toHaveAttribute('aria-expanded', 'true');
  await expect(row.locator('[data-testid="file-tree"]')).toBeVisible();
});

test('Open all changes on a collapsed row opens one multi-diff tab and leaves the row collapsed', async ({
  relaunch,
}) => {
  const page = await openReviewListing(relaunch);
  const row = reviewRow(page);
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  await row.hover();
  await row.locator('button[aria-label="Open all changes"]').click();

  await expect(tabOfKind(page, 'repo-multi-diff')).toHaveCount(1);
  await expect(row).toHaveAttribute('aria-expanded', 'false');
});

test('Open in graph activates the graph tab on that commit', async ({ relaunch }) => {
  const page = await openReviewListing(relaunch);
  const row = reviewRow(page);
  await row.hover();
  await row.locator('button[aria-label="Open in graph"]').click();

  await expect(tabOfKind(page, 'repo-graph')).toHaveAttribute('data-active', 'true');
  await expect(page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"]')).toBeVisible();
});

test('the Files pane reviewed control is a checkbox with three states', async ({ relaunch }) => {
  const page = await openReviewListing(relaunch);
  await page.locator('.kv-review-toolbar [aria-label^="Files"]').click();

  const box = (path: string) =>
    page
      .locator('.kv-review-files-tree .kv-file-tree-row', { hasText: base(path) })
      .locator('[role="checkbox"]');
  await expect(box(REVIEW_FILE_NONE)).toHaveAttribute('aria-checked', 'false');
  await expect(box(REVIEW_FILE_PARTIAL)).toHaveAttribute('aria-checked', 'mixed');
  await expect(box(REVIEW_FILE_FULL)).toHaveAttribute('aria-checked', 'true');
});

test('Space on the focused reviewed checkbox marks the file', async ({ relaunch }) => {
  const page = await openReviewListing(relaunch);
  await page.locator('.kv-review-toolbar [aria-label^="Files"]').click();
  const box = page
    .locator('.kv-review-files-tree .kv-file-tree-row', { hasText: base(REVIEW_FILE_NONE) })
    .locator('[role="checkbox"]');
  await box.focus();
  await page.keyboard.press('Space');

  await expect
    .poll(async () =>
      (await gitStreamParams(page, 'review.mark')).map((p) => (p as { path: string }).path),
    )
    .toEqual([REVIEW_FILE_NONE]);
});

test('the back button returns to branch selection', async ({ relaunch }) => {
  const page = await openReviewListing(relaunch);
  await expect(page.locator('[data-testid="review-no-branch"]')).toHaveCount(0);
  await page.locator('[data-testid="review-back-button"]').click();
  await expect(page.locator('[data-testid="review-no-branch"]')).toBeVisible();
});

test('600 commits mount 500 rows; Show more reveals the rest', async ({ relaunch }) => {
  const total = 600;
  const page = await openReviewListing(relaunch, { chunks: oneChunk(manyRows(total)) });
  const rows = page.locator('[data-testid^="review-row-"]');
  await expect(rows).toHaveCount(500);

  const showMore = page.locator('.kv-review-load-more-button');
  await expect(showMore).toHaveText(/Show 100 more/);
  await showMore.click();
  await expect(rows).toHaveCount(total);
  await expect(showMore).toBeHidden();
  await expect(reviewRow(page, manyRowShas(total - 1))).toHaveCount(1);
});

test('Review branch changes from the picker opens the Review tab on that branch', async ({
  relaunch,
}) => {
  const page = await openPortGraph(relaunch, {
    chunks: singleRowChunks([rootRow(SHA_A, 'A commit')]),
    results: { ...PICKER_RESULTS, ...REVIEW_RESULTS, 'refs.list': PICKER_RESULTS['refs.list'] },
  });
  await expect(page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"]')).toBeVisible();
  await page.locator('.kv-branch-trigger').click();
  await page
    .locator('[data-row-id="branch:refs/heads/feature-auth"]')
    .getByRole('button', { name: 'More actions' })
    .click();
  await page.getByText('Review branch changes').click();

  await expect(page.locator('[data-testid="review-branch-name"]')).toHaveText('feature-auth');
});
