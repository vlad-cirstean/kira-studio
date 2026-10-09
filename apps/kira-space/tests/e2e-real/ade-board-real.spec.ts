import { join } from 'node:path';
import { expect, test } from './fixtures';
import { createRepo, createRepoWithRemote } from './support/gitRepo';

test('Refresh all fetches a repo with a remote and rescans one without', async ({
  kira,
  consoleErrors,
}) => {
  const withRemote = join(kira.work, 'api');
  const noRemote = join(kira.work, 'lib');
  await createRepoWithRemote(withRemote, join(kira.work, 'api-remote.git'), [
    { subject: 'api base', files: { 'a.txt': 'a\n' } },
  ]);
  await createRepo(noRemote, [{ subject: 'lib base', files: { 'b.txt': 'b\n' } }]);
  const api = await kira.call<{ id: string }>('CodeWorkspaceService', 'ImportRepo', {
    path: withRemote,
  });
  const lib = await kira.call<{ id: string }>('CodeWorkspaceService', 'ImportRepo', {
    path: noRemote,
  });
  await kira.call('AdeTaskService', 'CreateTask', {
    title: 'Fix login',
    codeRepoIds: [api.id, lib.id],
  });

  await kira.reload();
  const page = kira.window;
  await page.locator('[data-testid="mode-tab"][data-mode="ade"]').click();
  await page.locator('[data-testid="ade-plan"]').waitFor();

  const chip = (id: string) =>
    page.locator(
      `[data-testid="ade-repo-chip"][data-repo-id="${id}"] [data-testid="ade-repo-note"]`,
    );
  await expect(chip(api.id)).toHaveText('never fetched');
  await expect(chip(lib.id)).toHaveText('no remote');

  await page.locator('[data-testid="ade-refresh-all"]').click();
  await expect(chip(api.id)).toHaveText(/just now|ago/);
  await expect(chip(lib.id)).toContainText('no remote');
  await expect(page.locator('[data-testid="ade-refresh-all"]')).toHaveText('Refresh all');

  // P230 U1: a healthy refresh paints nothing red.
  await expect(page.locator('[data-testid="ade-plan"] .text-tone-red')).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});
