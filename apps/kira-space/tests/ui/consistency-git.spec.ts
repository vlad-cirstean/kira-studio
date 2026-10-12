import { buildPackedChunk } from '@kira/git-core/testing/packedChunk';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  COMMIT_DETAIL,
  openCommitDetail,
  openPortGraph,
  openReviewListing,
  PICKER_RESULTS,
  PORT_REPO,
  refRow,
  rootRow,
  SHA_A,
  singleRowChunks,
} from './support/gitUiPortFixtures';
import { buildGraphStreamChunk } from './support/graphStreamFixture';

// P266 stream C: the shared git behaviours (short SHA, capped lists, icons, menus, ages, catalog
// text). Backend counterparts live in the Go suites; these assert the rendered result.

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const firstRow = (page: Page) =>
  page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"]');

test('short SHA is 7 characters in the commit meta', async ({ relaunch }) => {
  const page = await openCommitDetail(relaunch);
  await expect(tid(page, 'commit-meta-sha')).toHaveText(SHA_A.slice(0, 7));
});

test('short SHA is 7 characters in the review row', async ({ relaunch }) => {
  const review = await openReviewListing(relaunch);
  const row = review.locator(`[data-testid="review-row-${SHA_A}"]`);
  await expect(row).toContainText(SHA_A.slice(0, 7));
  await expect(row).not.toContainText(SHA_A.slice(0, 8));
});

test('the tag list caps at 50 and Show more reveals the next page', async ({ relaunch }) => {
  const tags = Array.from({ length: 60 }, (_, i) =>
    refRow(`t${String(i).padStart(2, '0')}`, { refname: `refs/tags/t${i}`, kind: 'tag' }),
  );
  const page = await openPortGraph(relaunch, {
    chunks: singleRowChunks([rootRow(SHA_A, 'A commit')]),
    results: {
      ...PICKER_RESULTS,
      'refs.list': { ...PICKER_RESULTS['refs.list'], tags },
    },
  });
  await expect(firstRow(page)).toBeVisible();
  await tid(page, 'branch-trigger').click();
  await page.getByRole('button', { name: /^Tags/ }).click();

  const rows = page.locator('[data-row-id^="tag:"]');
  await expect(rows).toHaveCount(50);
  await page.getByRole('button', { name: 'Show more (10 remaining)' }).click();
  await expect(rows).toHaveCount(60);
  await expect(page.getByRole('button', { name: /Show more/ })).toHaveCount(0);
});

test('commit row menu offers New branch…', async ({ relaunch }) => {
  const page = await openPortGraph(relaunch, {
    chunks: singleRowChunks([rootRow(SHA_A, 'A commit')]),
    results: PICKER_RESULTS,
  });
  await firstRow(page).click({ button: 'right' });
  await expect(tid(page, 'menu-item-createBranchHere')).toHaveText('New branch…');
});

test('the push menu offers Force push…', async ({ relaunch }) => {
  const page = await openPortGraph(relaunch, {
    chunks: singleRowChunks([rootRow(SHA_A, 'A commit')]),
    results: {
      ...PICKER_RESULTS,
      'refs.list': {
        ...PICKER_RESULTS['refs.list'],
        branches: [
          refRow('main', { upstream: 'refs/remotes/origin/main', track: { ahead: 0, behind: 0 } }),
        ],
        remoteBranches: [
          refRow('origin/main', {
            refname: 'refs/remotes/origin/main',
            kind: 'remoteBranch',
            isHead: false,
          }),
        ],
      },
    },
  });
  await expect(firstRow(page)).toBeVisible();
  await tid(page, 'push-overflow-trigger').click();
  await expect(page.getByRole('menuitem', { name: 'Force push…' })).toBeVisible();
});

test('the graph date column shows a compact age from the format catalog', async ({ relaunch }) => {
  const timestamp = Math.floor(Date.now() / 1000) - 330;
  const chunk = buildGraphStreamChunk(
    PORT_REPO.repoId,
    0,
    buildPackedChunk([rootRow(SHA_A, 'A commit')], {
      from: 0,
      dictionary: ['Fake Author', 'fake@example.com'],
      timestamp,
    }),
    { exhausted: true, remaining: 0 },
  );
  const page = await openPortGraph(relaunch, { chunks: [chunk], results: PICKER_RESULTS });
  await expect(firstRow(page).locator('.kira-cell-date').first()).toHaveText('5m');
});

test('an empty tag name shows the catalog error', async ({ relaunch }) => {
  const page = await openPortGraph(relaunch, {
    chunks: singleRowChunks([rootRow(SHA_A, 'A commit')]),
    results: { ...PICKER_RESULTS, 'commit.detail': COMMIT_DETAIL },
  });
  await firstRow(page).click({ button: 'right' });
  await tid(page, 'menu-item-createTagHere').click();

  await expect(page.getByRole('dialog')).toContainText('Name can’t be empty.');
});

test('row remove buttons use codicons: worktree trash, stack close', async ({ relaunch }) => {
  const page = await openPortGraph(relaunch, {
    chunks: singleRowChunks([rootRow(SHA_A, 'A commit')]),
    results: {
      ...PICKER_RESULTS,
      'worktree.list': {
        worktrees: [
          ...PICKER_RESULTS['worktree.list'].worktrees,
          {
            ...PICKER_RESULTS['worktree.list'].worktrees[0],
            path: '/tmp/port-repo-wt',
            branch: 'refs/heads/wt',
            isMain: false,
            isCurrent: false,
          },
        ],
      },
    },
  });
  await expect(firstRow(page)).toBeVisible();
  await tid(page, 'branch-trigger').click();

  await page.getByRole('button', { name: /^Worktrees/ }).click();
  await expect(
    page.getByRole('button', { name: 'Remove worktree' }).locator('.codicon-trash'),
  ).toBeVisible();

  await page.getByRole('button', { name: /^Stacks/ }).click();
  await expect(
    page.getByRole('button', { name: 'Remove from stack' }).locator('.codicon-close'),
  ).toBeVisible();
});
