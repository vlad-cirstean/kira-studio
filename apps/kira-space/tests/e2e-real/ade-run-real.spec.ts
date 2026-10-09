import { join } from 'node:path';
import { expect, test } from './fixtures';
import { addTask, type Board, DONE_SCENARIO, openPlan, runTask, saveFlow } from './support/ade';
import { createRepoWithRemote } from './support/gitRepo';

test.use({ scenario: DONE_SCENARIO });

test('a run finishes its first step and waits for approval on the second', async ({ kira }) => {
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
  await runTask(page, 'feat/api-run');

  const step = (id: string) => page.locator(`[data-testid="ade-step"][data-step-id="${id}"]`);
  await expect(step('one')).toContainText(/done/i, { timeout: 30_000 });
  const approve = page.locator('[data-testid="ade-step-approve"]');
  await expect(approve).toBeVisible({ timeout: 30_000 });
  await approve.click();
  await expect(step('two')).toContainText(/done/i, { timeout: 30_000 });
  await expect(approve).toHaveCount(0);

  await expect(page.locator('[data-testid="ade-stage-block"]')).toContainText('2/2');
  const board = await kira.call<Board>('AdeTaskService', 'Board');
  expect(board.tasks[0]?.runs.map((r) => `${r.stepId}:${r.state}`).sort()).toEqual([
    'one:done',
    'two:done',
  ]);
});
