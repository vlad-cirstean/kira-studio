import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { createRepo, git } from './support/gitRepo';

// A branch switch blocked by a dirty tree auto-stashes (default setting) through the real server;
// the stash list shows the entry and Pop brings the change back on its origin branch.

test('checkout from the branch picker auto-stashes a blocking change, and Pop restores it', async ({
  kira,
}) => {
  const repo = join(kira.work, 'stash');
  await createRepo(repo, [
    { subject: 'base', files: { 'file.txt': 'base\n', 'other.txt': 'o\n' } },
  ]);
  git(repo, 'checkout', '-q', '-b', 'topic');
  await writeFile(join(repo, 'file.txt'), 'topic side\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'topic change');
  git(repo, 'checkout', '-q', 'main');
  await writeFile(join(repo, 'file.txt'), 'dirty on main\n');

  const rec = await kira.call<{ id: string }>('CodeWorkspaceService', 'ImportRepo', { path: repo });
  await kira.reload();
  const page = kira.window;
  await page.locator(`[data-testid="repo-row"][data-repo-id="${rec.id}"]`).click();
  await expect(page.getByText('topic change').first()).toBeVisible();

  const picker = async () => {
    await page.locator('.kv-branch-trigger').click();
    await expect(page.getByRole('region', { name: 'Branches', exact: true })).toBeVisible();
  };

  await picker();
  await page.locator('.kv-branch-row-main', { hasText: 'topic' }).first().click();
  await expect.poll(() => git(repo, 'symbolic-ref', '--short', 'HEAD')).toBe('topic');
  expect(await readFile(join(repo, 'file.txt'), 'utf8')).toBe('topic side\n');
  const stashes = git(repo, 'stash', 'list').split('\n').filter(Boolean);
  expect(stashes).toHaveLength(1);
  expect(stashes[0]).toMatch(/main/);

  // Back on main the picker lists the entry; Pop restores the change and empties the stack.
  await expect
    .poll(async () => (await page.locator('.kv-branch-trigger').textContent()) ?? '')
    .toContain('topic');
  await picker();
  await page.locator('.kv-branch-row-main', { hasText: 'main' }).first().click();
  await expect.poll(() => git(repo, 'symbolic-ref', '--short', 'HEAD')).toBe('main');

  await picker();
  await page.getByRole('button', { name: /^Stashes \(1\)/ }).click();
  const row = page.locator('.kv-branch-row', { hasText: '1 file' }).first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Pop' }).click();

  await expect.poll(() => readFile(join(repo, 'file.txt'), 'utf8')).toBe('dirty on main\n');
  expect(git(repo, 'stash', 'list')).toBe('');
});
