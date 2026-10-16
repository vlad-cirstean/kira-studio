import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  manyRowShas,
  manyRows,
  oneChunk,
  openBranchPicker,
  openCommitDetail,
  openReviewListing,
} from './support/gitUiPortFixtures';

// P264: the git lists bound through the shared useListNavigation: commit file tree, branch picker
// and review commit list. Same key set as every other list; the menu returns focus to its row.

const menu = (p: Page) => p.locator('[data-testid="context-menu"]');

test('commit file tree — roving tab stop, Left/Right on a folder, Shift+F10 on a file and focus return', async ({
  relaunch,
}) => {
  const page = await openCommitDetail(relaunch);
  const rows = page.locator('[data-testid="file-tree"] [data-testid="file-tree-row"]');
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  expect(count).toBeGreaterThan(2);
  await expect(page.locator('[data-testid="file-tree-row"][tabindex="0"]')).toHaveCount(1);

  const folder = rows.first();
  await folder.focus();
  await expect(folder).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(folder).toHaveAttribute('aria-expanded', 'false');
  await expect(rows).toHaveCount(count - 1);
  await page.keyboard.press('ArrowRight');
  await expect(folder).toHaveAttribute('aria-expanded', 'true');
  await expect(rows).toHaveCount(count);

  const file = rows.nth(1);
  await file.focus();
  await page.keyboard.press('Shift+F10');
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(file).toBeFocused();
});

test('commit file tree — moving onto a file previews its diff', async ({ relaunch }) => {
  const page = await openCommitDetail(relaunch);
  const tabs = page.locator(
    '[data-testid="tab-strip-wrapper"] [data-testid="tab"][data-tab-kind="repo-diff"]',
  );
  const rows = page.locator('[data-testid="file-tree"] [data-testid="file-tree-row"]');
  await rows.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(tabs).toHaveCount(1);
});

test('branch picker — filter hands off to rows, arrows and Home/End move, Shift+F10 returns focus', async ({
  relaunch,
}) => {
  const page = await openBranchPicker(relaunch);
  const filter = page.locator('input[aria-label="Filter branches"]');
  const main = page.locator('[data-row-id="branch:refs/heads/main"]');
  const auth = page.locator('[data-row-id="branch:refs/heads/feature-auth"]');
  await expect(filter).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(main).toBeFocused();
  await expect(main).toHaveAttribute('tabindex', '0');
  await page.keyboard.press('ArrowDown');
  await expect(auth).toBeFocused();
  await expect(main).toHaveAttribute('tabindex', '-1');
  await page.keyboard.press('Home');
  await expect(main).toBeFocused();
  await page.keyboard.press('End');
  await expect(auth).toBeFocused();

  await page.keyboard.press('Shift+F10');
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(auth).toBeFocused();

  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowUp');
  await expect(filter).toBeFocused();
});

test('review list — arrows move, Right expands and Left collapses a commit', async ({
  relaunch,
}) => {
  const page = await openReviewListing(relaunch, { chunks: oneChunk(manyRows(4)) });
  const row = (i: number) => page.locator(`[data-testid="review-row-${manyRowShas(i)}"]`);
  await expect(row(0)).toBeVisible();
  await expect(page.locator('[data-testid^="review-row-"][tabindex="0"]')).toHaveCount(1);

  await row(0).focus();
  await page.keyboard.press('ArrowDown');
  await expect(row(1)).toBeFocused();
  await expect(row(1)).toHaveAttribute('tabindex', '0');

  await expect(row(1)).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('ArrowRight');
  await expect(row(1)).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(row(1)).toHaveAttribute('aria-expanded', 'false');

  await page.keyboard.press('Home');
  await expect(row(0)).toBeFocused();
  await page.keyboard.press('End');
  await expect(row(3)).toBeFocused();
});
