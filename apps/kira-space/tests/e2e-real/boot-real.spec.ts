import { join } from 'node:path';
import { expect, test } from './fixtures';
import { createRepo } from './support/gitRepo';

test('boots the real server, imports a real repo, opens its graph', async ({ kira }) => {
  const repo = join(kira.work, 'smoke');
  await createRepo(repo, [
    { subject: 'first commit', files: { 'a.txt': 'a\n' } },
    { subject: 'second commit', files: { 'b.txt': 'b\n' } },
  ]);

  const rec = await kira.call<{ id: string; name: string }>('CodeWorkspaceService', 'ImportRepo', {
    path: repo,
  });
  expect(rec.name).toBe('smoke');

  await kira.reload();
  const page = kira.window;
  const row = page.locator(`[data-testid="repo-row"][data-repo-id="${rec.id}"]`);
  await expect(row).toBeVisible();
  await row.click();
  await expect(
    page.locator('[data-testid="repo-graph-host"] [data-testid="connection-state"]'),
  ).toHaveText(/connected/i);
  await expect(page.getByText('second commit').first()).toBeVisible();
});
