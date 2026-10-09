import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { addTask, type Board, DONE_SCENARIO, openPlan, runTask, saveFlow } from './support/ade';
import { createRepoWithRemote, git } from './support/gitRepo';

test.use({ scenario: DONE_SCENARIO });

// Real git facts drive the Review code button; a click opens the branch's review window.
test('Review code follows the real commits of a branch', async ({ kira }) => {
  const repo = join(kira.work, 'api');
  await createRepoWithRemote(repo, join(kira.work, 'api-remote.git'), [
    { subject: 'api base', files: { 'a.txt': 'a\n' } },
  ]);
  await kira.call('CodeWorkspaceService', 'ImportRepo', { path: repo });
  await saveFlow(kira);

  const page = await openPlan(kira);
  await addTask(page, 'Fix login');
  const card = page.locator('[data-testid="ade-card"]', { hasText: 'Fix login' });
  await card.locator('[data-testid="ade-card-head"]').click();
  await runTask(page, 'feat/api-open');
  await expect(page.locator('[data-testid="ade-step"][data-step-id="one"]')).toContainText(
    /done/i,
    {
      timeout: 30_000,
    },
  );

  const board = await kira.call<Board>('AdeTaskService', 'Board');
  const worktree = board.branches[0]?.worktree ?? '';
  expect(worktree).not.toBe('');
  const refresh = async () => {
    await page.locator('[data-testid="ade-refresh-all"]').click();
    await expect(page.locator('[data-testid="ade-refresh-all"]')).toHaveText('Refresh all');
  };
  const button = card.locator('[data-testid="ade-card-review"]');

  writeFileSync(join(worktree, 'wip.txt'), 'wip\n');
  await refresh();
  await expect(button).toBeDisabled();
  await button.locator('xpath=..').hover();
  const tip = page.locator('[data-slot="tooltip-content"]');
  await expect(tip).toContainText('Only uncommitted changes on');
  await expect(tip.locator('[data-var="base"]')).toHaveText(/main/);

  git(worktree, 'add', '-A');
  git(worktree, 'commit', '-q', '-m', 'add wip');
  await refresh();
  await expect(button).toBeEnabled();
  await button.hover();
  await expect(tip).toContainText('against');
  await expect(tip.locator('[data-var="branch"]')).toHaveText('feat/api-open');
  await button.click();
  // The click created the branch's review window row, so a second open only focuses it.
  await expect(button).toBeEnabled();
  expect(
    await kira.call('AdeTaskService', 'OpenReviewWindow', { branchId: board.branches[0]?.id }),
  ).toBe(false);
});
