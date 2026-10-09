import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { createRepo, git } from './support/gitRepo';

// The detail pane's file list for a real merge and a real rename commit equals git's own
// name-status output, and a file opens its diff.

async function write(repo: string, rel: string, content: string): Promise<void> {
  await mkdir(dirname(join(repo, rel)), { recursive: true });
  await writeFile(join(repo, rel), content);
}

/** `STATUS path` lines from git, the new path for a rename or copy. */
function gitNameStatus(repo: string, args: string[]): string[] {
  const out = git(repo, ...args);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, ...paths] = line.split('\t');
      return `${status?.[0]} ${paths[paths.length - 1]}`;
    })
    .sort();
}

/** `STATUS path` for every file row of the open detail pane. */
async function paneFiles(page: Page): Promise<string[]> {
  const rows = await page
    .locator('[data-testid="file-tree"] [role="treeitem"][aria-selected]')
    .evaluateAll((els) =>
      els.map((el) => {
        const tips = [...el.querySelectorAll('[data-kira-tip]')].map((e) => ({
          tip: e.getAttribute('data-kira-tip') ?? '',
          text: (e.textContent ?? '').trim(),
        }));
        const name = tips.find((t) => t.tip && !/^\d+ (additions|deletions)$/.test(t.tip));
        const letter = tips[tips.length - 1]?.text ?? '';
        const path = (name?.tip ?? '').split(' → ').pop() ?? '';
        return { letter, path, tip: name?.tip ?? '' };
      }),
    );
  return rows.map((r) => `${r.letter} ${r.path}`).sort();
}

test('a merge and a rename commit list git’s own files and open a diff', async ({ kira }) => {
  const repo = join(kira.work, 'detail');
  await createRepo(repo, [
    {
      subject: 'base',
      files: {
        'a.txt': 'one\ntwo\nthree\n',
        'old/name.txt': 'rename me\nline\nline2\nline3\n',
        'keep.txt': 'k\n',
        'gone.txt': 'bye\n',
      },
    },
  ]);
  git(repo, 'checkout', '-q', '-b', 'feature');
  await mkdir(join(repo, 'new'), { recursive: true });
  git(repo, 'mv', 'old/name.txt', 'new/renamed.txt');
  git(repo, 'rm', '-q', 'gone.txt');
  await write(repo, 'a.txt', 'one\nTWO\nthree\nfour\n');
  await write(repo, 'deep/er/added.txt', 'added\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'feature work');
  git(repo, 'checkout', '-q', 'main');
  await write(repo, 'keep.txt', 'k2\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'main work');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge feature', 'feature');

  const rec = await kira.call<{ id: string }>('CodeWorkspaceService', 'ImportRepo', { path: repo });
  await kira.reload();
  const page = kira.window;
  await page.locator(`[data-testid="repo-row"][data-repo-id="${rec.id}"]`).click();
  const grid = page.locator('[data-testid="commit-grid"]');

  await grid.getByText('merge feature', { exact: true }).click();
  await expect(page.getByText('Diffing against')).toBeVisible();
  const merge = git(repo, 'rev-parse', 'HEAD');
  const mergeWant = gitNameStatus(repo, ['diff', '--name-status', '-M', `${merge}^1`, merge]);
  await expect.poll(() => paneFiles(page)).toEqual(mergeWant);

  // The second parent lists the other side's changes.
  await page.locator('[data-testid="file-tree"] select').selectOption('1');
  const secondWant = gitNameStatus(repo, ['diff', '--name-status', '-M', `${merge}^2`, merge]);
  await expect.poll(() => paneFiles(page)).toEqual(secondWant);

  await grid.getByText('feature work', { exact: true }).click();
  const feature = git(repo, 'rev-parse', 'feature');
  const featureWant = gitNameStatus(repo, ['show', '--name-status', '-M', '--format=', feature]);
  await expect.poll(() => paneFiles(page)).toEqual(featureWant);
  expect(featureWant.some((l) => l.startsWith('R '))).toBe(true);

  await page.locator('[data-testid="file-tree"] [role="treeitem"]', { hasText: 'a.txt' }).click();
  const diff = page.locator('[data-testid="repo-diff-editor"]');
  await expect(diff).toBeVisible();
  await expect(diff).toContainText('TWO');
});
