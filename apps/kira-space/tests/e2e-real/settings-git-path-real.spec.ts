import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { createRepo } from './support/gitRepo';

test('a bad Git path blocks the graph naming it, and clearing it recovers', async ({ kira }) => {
  const repo = join(kira.work, 'smoke');
  await createRepo(repo, [{ subject: 'first commit', files: { 'a.txt': 'a\n' } }]);
  const rec = await kira.call<{ id: string }>('CodeWorkspaceService', 'ImportRepo', { path: repo });
  // A missing file falls back to PATH on Linux, so the bad path is an executable that is not git.
  const fake = join(kira.work, 'not-git');
  await writeFile(fake, '#!/bin/sh\necho not-git\n');
  await chmod(fake, 0o755);

  const page = kira.window;
  const setGitPath = async (value: string) => {
    await page.locator('[data-testid="open-settings"]').click();
    await page.locator('[data-testid="settings-section-Git"]').click();
    await page.locator('[data-testid="settings-git-path"]').fill(value);
    await page.locator('[data-testid="settings-save"]').click();
    await expect(page.locator('[data-testid="settings-dialog"]')).toHaveCount(0);
  };
  const openRepo = async () => {
    await kira.reload();
    await page.locator(`[data-testid="repo-row"][data-repo-id="${rec.id}"]`).click();
  };

  await setGitPath(fake);
  await openRepo();
  const blocked = page.locator('[data-testid="git-blocked-panel"]');
  await expect(blocked).toBeVisible();
  await expect(blocked).toContainText(fake);

  await setGitPath('');
  await openRepo();
  await expect(page.locator('[data-testid="git-blocked-panel"]')).toHaveCount(0);
  await expect(
    page.locator('[data-testid="repo-graph-host"] [data-testid="connection-state"]'),
  ).toHaveText(/connected/i);
  await expect(page.getByText('first commit').first()).toBeVisible();
});
