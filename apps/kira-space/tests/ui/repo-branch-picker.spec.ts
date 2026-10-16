import { expect, test } from './fixtures';
import { contract } from './support/contract';
import {
  openBranchPicker,
  openPortGraph,
  PICKER_RESULTS,
  rootRow,
  SHA_A,
  singleRowChunks,
} from './support/gitUiPortFixtures';

// The branch picker's five-tab fold inside Space. Ported from the VS Code webview suite.

test('five tabs show badges that match the seeded counts', async ({ relaunch }) => {
  const page = await openBranchPicker(relaunch);
  // Branches, Tags, Stashes, Worktrees, Stacks.
  await expect(
    page.locator('[data-testid="branch-tabs"] [data-testid="picker-tab-badge"]'),
  ).toHaveText(['2', '1', '1', '1', '1']);
});

test('Stashes swaps the body and relabels the filter', async ({ relaunch }) => {
  const page = await openBranchPicker(relaunch);
  await page.getByRole('button', { name: /^Stashes/ }).click();
  await expect(page.locator('[data-testid="branch-section"][aria-label="Stashes"]')).toBeVisible();
  await expect(page.locator('input[aria-label="Filter stashes"]')).toBeVisible();
});

test('a query on Branches badges Stashes and survives the tab switch', async ({ relaunch }) => {
  const page = await openBranchPicker(relaunch);
  await page.locator('input[aria-label="Filter branches"]').fill('auth');

  const stashesTab = page.getByRole('button', { name: /^Stashes/ });
  await expect(stashesTab.locator('[data-testid="picker-tab-badge"]')).toHaveText('1');

  await stashesTab.click();
  await expect(page.locator('input[aria-label="Filter stashes"]')).toHaveValue('auth');
  await expect(
    page.locator(
      '[data-testid="branch-section"][aria-label="Stashes"] [data-testid="stash-message"]',
    ),
  ).toHaveText('auth work');
});

test('the filter takes focus on open; ArrowDown enters the rows, ArrowUp returns', async ({
  relaunch,
}) => {
  const page = await openBranchPicker(relaunch);
  const filter = page.locator('input[aria-label="Filter branches"]');
  await expect(filter).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-row-id="branch:refs/heads/main"]')).toBeFocused();

  await page.keyboard.press('ArrowUp');
  await expect(filter).toBeFocused();
});

// Contract git-stash. Backend half: gitflow TestCheckoutDirtyAutostash. The entry is what an
// auto-stash on a blocked checkout leaves; the picker lists it under Stashes.
test('contract: the Stashes tab lists the entry an auto-stash leaves', async ({ relaunch }) => {
  const list = contract<{ entries: { message: string; branch: string }[] }>(
    'git-stash',
    'git:stash.list#autostash',
  );
  const [entry] = list.entries;
  const page = await openPortGraph(relaunch, {
    chunks: singleRowChunks([rootRow(SHA_A, 'A commit')]),
    results: { ...PICKER_RESULTS, 'stash.list': list },
  });
  await expect(page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"]')).toBeVisible();
  await page.locator('[data-testid="branch-trigger"]').click();
  await page.getByRole('button', { name: /^Stashes/ }).click();
  await expect(
    page.locator(
      '[data-testid="branch-section"][aria-label="Stashes"] [data-testid="stash-message"]',
    ),
  ).toHaveText(entry.message.replace(/^On [^:]+: /, ''));
});
