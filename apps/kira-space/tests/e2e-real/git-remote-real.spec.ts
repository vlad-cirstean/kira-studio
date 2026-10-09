import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { git } from './support/gitRepo';

// Fetch, Pull and Push from the toolbar against a real bare remote that a second clone also
// pushes to; the branch picker's ahead/behind marks and the Operations panel follow.

async function commitFile(repo: string, name: string, subject: string): Promise<string> {
  await mkdir(repo, { recursive: true });
  await writeFile(join(repo, name), `${subject}\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', subject);
  return git(repo, 'rev-parse', 'HEAD');
}

/** Text of the current branch's row in the branch picker (name plus any ↑/↓ mark). */
async function branchRow(page: Page, branch: string): Promise<string> {
  await page.locator('.kv-branch-trigger').click();
  const row = page.locator('.kv-branch-row-main', { hasText: branch }).first();
  await expect(row).toBeVisible();
  const text = ((await row.textContent()) ?? '').replace(/\s+/g, ' ').trim();
  await page.keyboard.press('Escape');
  return text;
}

test('Fetch, Pull and Push from the toolbar move real refs and show in Operations', async ({
  kira,
}) => {
  const bare = join(kira.work, 'remote.git');
  const seed = join(kira.work, 'seed');
  const mine = join(kira.work, 'mine');
  const other = join(kira.work, 'other');

  git(kira.work, 'init', '-q', '--bare', '-b', 'main', bare);
  await mkdir(seed, { recursive: true });
  git(seed, 'init', '-q', '-b', 'main');
  await commitFile(seed, 'seed.txt', 'seed commit');
  git(seed, 'remote', 'add', 'origin', bare);
  git(seed, 'push', '-q', 'origin', 'main');
  git(kira.work, 'clone', '-q', bare, mine);
  git(kira.work, 'clone', '-q', bare, other);

  const rec = await kira.call<{ id: string }>('CodeWorkspaceService', 'ImportRepo', { path: mine });
  await kira.reload();
  const page = kira.window;
  await page.locator(`[data-testid="repo-row"][data-repo-id="${rec.id}"]`).click();
  await expect(page.getByText('seed commit').first()).toBeVisible();
  expect(await branchRow(page, 'main')).not.toMatch(/[↑↓]/);

  // A second clone pushes; Fetch shows this clone behind by one.
  const theirTip = await commitFile(other, 'theirs.txt', 'theirs commit');
  git(other, 'push', '-q', 'origin', 'main');
  await page.locator('[data-testid="fetch-button"]').click();
  await expect(page.getByText('theirs commit').first()).toBeVisible();
  await expect.poll(() => branchRow(page, 'main')).toContain('↓1');
  expect(git(mine, 'rev-parse', 'origin/main')).toBe(theirTip);

  // Pull fast-forwards.
  await page.locator('[data-testid="pull-button"]').click();
  await expect.poll(() => git(mine, 'rev-parse', 'HEAD')).toBe(theirTip);
  await expect.poll(() => branchRow(page, 'main')).not.toMatch(/[↑↓]/);

  // A local commit shows ahead by one; Push publishes it.
  const myTip = await commitFile(mine, 'mine.txt', 'my commit');
  await expect.poll(() => branchRow(page, 'main')).toContain('↑1');
  await page.locator('[data-testid="push-button"]').click();
  await expect.poll(() => git(bare, 'rev-parse', 'main')).toBe(myTip);
  await expect.poll(() => branchRow(page, 'main')).not.toMatch(/[↑↓]/);

  // Operations lists the three remote operations.
  await page.locator('[data-testid="toggle-operations-panel"]').click();
  const ops = page.locator('[data-testid="operations-panel"] [data-testid="op-row"]');
  await expect(ops.filter({ hasText: /fetch/i })).not.toHaveCount(0);
  await expect(ops.filter({ hasText: /pull/i })).not.toHaveCount(0);
  await expect(ops.filter({ hasText: /push/i })).not.toHaveCount(0);
  await expect(page.locator('[data-testid="op-row"][data-status="error"]')).toHaveCount(0);
});
