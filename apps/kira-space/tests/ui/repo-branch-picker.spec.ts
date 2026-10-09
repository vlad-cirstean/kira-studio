import { expect, test } from './fixtures';
import { openBranchPicker } from './support/gitUiPortFixtures';

// The branch picker's five-tab fold inside Space. Ported from the VS Code webview suite.

test('five tabs show badges that match the seeded counts', async ({ relaunch }) => {
  const page = await openBranchPicker(relaunch);
  // Branches, Tags, Stashes, Worktrees, Stacks.
  await expect(page.locator('.kv-branch-tabs [data-testid="picker-tab-badge"]')).toHaveText([
    '2',
    '1',
    '1',
    '1',
    '1',
  ]);
});

test('Stashes swaps the body and relabels the filter', async ({ relaunch }) => {
  const page = await openBranchPicker(relaunch);
  await page.getByRole('button', { name: /^Stashes/ }).click();
  await expect(page.locator('.kv-branch-section[aria-label="Stashes"]')).toBeVisible();
  await expect(page.locator('input[aria-label="Filter stashes"]')).toBeVisible();
});

test('a query on Branches badges Stashes and survives the tab switch', async ({ relaunch }) => {
  const page = await openBranchPicker(relaunch);
  await page.locator('input[aria-label="Filter branches"]').fill('auth');

  const stashesTab = page.getByRole('button', { name: /^Stashes/ });
  await expect(stashesTab).toHaveAttribute('aria-label', 'Stashes (1)');

  await stashesTab.click();
  await expect(page.locator('input[aria-label="Filter stashes"]')).toHaveValue('auth');
  await expect(
    page.locator('.kv-branch-section[aria-label="Stashes"] .kv-stash-message'),
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
