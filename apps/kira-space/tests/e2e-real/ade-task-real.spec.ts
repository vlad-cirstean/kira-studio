import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { addTask, type Board, DONE_SCENARIO, openPlan, runTask, saveFlow } from './support/ade';
import { createRepoWithRemote, git } from './support/gitRepo';

test.use({ scenario: DONE_SCENARIO });

test('a run gives a task a real worktree, and archiving removes it', async ({ kira }) => {
  const repo = join(kira.work, 'api');
  await createRepoWithRemote(repo, join(kira.work, 'api-remote.git'), [
    { subject: 'api base', files: { 'a.txt': 'a\n' } },
  ]);
  await kira.call('CodeWorkspaceService', 'ImportRepo', { path: repo });
  await saveFlow(kira);

  const page = await openPlan(kira);
  await addTask(page, 'Fix login');
  const card = page.locator('[data-testid="ade-card"]', { hasText: 'Fix login' });
  await expect(card).toBeVisible();
  await card.locator('[data-testid="ade-card-head"]').click();
  await runTask(page, 'feat/api-work');

  await expect
    .poll(async () => {
      const board = await kira.call<Board>('AdeTaskService', 'Board');
      return board.branches.find((b) => b.name === 'feat/api-work')?.worktree ?? '';
    })
    .not.toBe('');
  const board = await kira.call<Board>('AdeTaskService', 'Board');
  const worktree = board.branches.find((b) => b.name === 'feat/api-work')?.worktree ?? '';
  expect(existsSync(join(worktree, 'a.txt'))).toBe(true);
  expect(git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feat/api-work');
  await expect(card).toContainText('feat/api-work');

  await page.locator('[data-testid="ade-panel-archive"]').click();
  await expect(card).toHaveCount(0);
  await expect.poll(() => existsSync(worktree)).toBe(false);
  expect(git(repo, 'branch', '--list', 'feat/api-work')).toContain('feat/api-work');
});
