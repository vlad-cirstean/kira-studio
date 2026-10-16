import { expect, test } from './fixtures';
import { installGitStreamMock } from './support/gitStreamMock';
import {
  buildGraphStreamChunk,
  buildMultiBranchChunk,
  buildMultiBranchRefsList,
  MULTI_BRANCH_SHAS,
} from './support/graphStreamFixture';
import { IPC } from './support/ipcChannels';
import type { ControlSnapshot } from './support/types';

const REPO = {
  id: 'repo-pr-1',
  name: 'pr-repo',
  root: '/tmp/pr-repo',
  repoId: '/tmp/pr-repo',
  sortOrder: 1,
  color: 'none',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const CONTROL: ControlSnapshot[] = [
  { channel: IPC.codeWorkspaceListRepos, response: [REPO] },
  {
    channel: IPC.codeWorkspaceListFiles,
    args: { id: REPO.id },
    response: { paths: ['a.ts'], status: {}, truncated: false },
  },
];

// Collapsed default display order: M0 M1 M2 F0 [placeholder] F4 G0 G1. feature-older: G0 tip
// (row 6), G1 oldest (row 7).
const TIP_ROW = 6;
const NON_TIP_ROW = 7;

function message(page: import('@playwright/test').Page, row: number) {
  return page.locator(
    `[data-testid="commit-grid"] .slick-row[data-row="${row}"] .kira-cell-message`,
  );
}

test('a PR badges only the commit its head points at, not the rest of its branch', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: CONTROL });
  await installGitStreamMock(
    page,
    REPO.repoId,
    {
      'repo.open': {
        kind: 'ok',
        repo: {
          repoId: REPO.repoId,
          root: REPO.root,
          gitDir: `${REPO.root}/.git`,
          commonDir: `${REPO.root}/.git`,
          isBare: false,
          isLinkedWorktree: false,
          head: { kind: 'branch', name: 'main' },
        },
      },
      'refs.list': buildMultiBranchRefsList(),
      'commit.resolvePr': {
        kind: 'ok',
        prs: [
          {
            number: 42,
            title: 'feature-older',
            url: 'https://github.com/acme/widgets/pull/42',
            state: 'open',
            headRef: 'feature-older',
            headSha: MULTI_BRANCH_SHAS.featureOlderTip,
            baseRef: 'main',
            updatedAt: 0,
          },
        ],
      },
    },
    [buildGraphStreamChunk(REPO.repoId, 0, buildMultiBranchChunk())],
  );
  await page.locator(`[data-testid="repo-row"][data-repo-id="${REPO.id}"]`).click();
  await expect(message(page, NON_TIP_ROW)).toBeVisible();

  await message(page, NON_TIP_ROW).click();

  await expect(message(page, TIP_ROW).locator('[data-testid="badge-pr"]')).toHaveText('#42');
  await expect(message(page, NON_TIP_ROW).locator('[data-testid="badge-pr"]')).toHaveCount(0);
});
