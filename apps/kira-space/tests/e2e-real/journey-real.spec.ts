import { join } from 'node:path';
import { expect, test } from './fixtures';
import { addTask, type Board, DONE_SCENARIO, openPlan, runTask, saveFlow } from './support/ade';
import { createRepoWithRemote, git } from './support/gitRepo';

test.use({ scenario: DONE_SCENARIO });

// One continuous session: import a repo, see a new commit land in its graph, file an ADE task, run
// it with the fake claude to completion, then reload and find all of it still there.
test('import, new commit, ADE run to done, reload keeps it all', async ({ kira }) => {
  const repo = join(kira.work, 'proj');
  await createRepoWithRemote(repo, join(kira.work, 'proj-remote.git'), [
    { subject: 'proj base', files: { 'a.txt': 'a\n' } },
  ]);
  const rec = await kira.call<{ id: string }>('CodeWorkspaceService', 'ImportRepo', { path: repo });
  await saveFlow(kira);

  const page = kira.window;
  await page.locator(`[data-testid="repo-row"][data-repo-id="${rec.id}"]`).click();
  await expect(page.getByText('proj base').first()).toBeVisible();
  git(repo, 'commit', '--allow-empty', '-q', '-m', 'landed while open');
  await kira.reload();
  await page.locator(`[data-testid="repo-row"][data-repo-id="${rec.id}"]`).click();
  await expect(page.getByText('landed while open').first()).toBeVisible();

  await openPlan(kira);
  await addTask(page, 'Journey task');
  const card = page.locator('[data-testid="ade-card"]', { hasText: 'Journey task' });
  await card.locator('[data-testid="ade-card-head"]').click();
  await runTask(page, 'feat/journey');
  const step = (id: string) => page.locator(`[data-testid="ade-step"][data-step-id="${id}"]`);
  await expect(step('one')).toContainText(/done/i, { timeout: 30_000 });
  await page.locator('[data-testid="ade-step-approve"]').click();
  await expect(step('two')).toContainText(/done/i, { timeout: 30_000 });

  await kira.reload();
  await page.locator('[data-testid="mode-tab"][data-mode="ade"]').click();
  await expect(page.locator('[data-testid="ade-card"]', { hasText: 'Journey task' })).toBeVisible();
  const board = await kira.call<Board>('AdeTaskService', 'Board');
  expect(board.tasks.map((t) => t.title)).toEqual(['Journey task']);
  expect(board.tasks[0]?.runs.map((r) => `${r.stepId}:${r.state}`).sort()).toEqual([
    'one:done',
    'two:done',
  ]);
});
