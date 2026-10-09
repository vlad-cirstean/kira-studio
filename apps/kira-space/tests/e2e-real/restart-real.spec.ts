import { join } from 'node:path';
import { expect, test } from './fixtures';
import { addTask, type Board, DONE_SCENARIO, openPlan, saveFlow } from './support/ade';
import { createRepoWithRemote } from './support/gitRepo';

test.use({ scenario: DONE_SCENARIO });

// SIGKILL and respawn on the same home: durable state (repos, ADE board, settings) is read back
// from SQLite, the way a crash-and-relaunch would.
test('repos, ADE board and settings survive a killed and relaunched server', async ({ kira }) => {
  const repo = join(kira.work, 'persist');
  await createRepoWithRemote(repo, join(kira.work, 'persist-remote.git'), [
    { subject: 'persist base', files: { 'a.txt': 'a\n' } },
  ]);
  const rec = await kira.call<{ id: string }>('CodeWorkspaceService', 'ImportRepo', { path: repo });
  await saveFlow(kira);
  await kira.call('SettingsService', 'Set', { patch: { git: { graphFontSize: 15 } } });
  const page = await openPlan(kira);
  await addTask(page, 'Survives restart');
  const before = await kira.call<Board>('AdeTaskService', 'Board');

  await kira.relaunch();

  const repos = await kira.call<{ id: string }[]>('CodeWorkspaceService', 'ListRepos');
  expect(repos.map((r) => r.id)).toEqual([rec.id]);
  const after = await kira.call<Board>('AdeTaskService', 'Board');
  expect(after.tasks.map((t) => t.id)).toEqual(before.tasks.map((t) => t.id));
  const settings = await kira.call<{ git: { graphFontSize: number } }>('SettingsService', 'GetAll');
  expect(settings.git.graphFontSize).toBe(15);

  await page.locator('[data-testid="mode-tab"][data-mode="ade"]').click();
  await expect(
    page.locator('[data-testid="ade-card"]', { hasText: 'Survives restart' }),
  ).toBeVisible();
});
