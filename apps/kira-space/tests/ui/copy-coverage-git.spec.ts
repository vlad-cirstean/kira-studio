import type { Page } from '@playwright/test';
import {
  expectCatalogText,
  setPseudoLocale,
} from '../../../../packages/workbench/src/testing/ui/copyCoverage';
import { expect, test } from './fixtures';
import {
  COMMIT_DETAIL,
  openPortGraph,
  openReviewListing,
  PICKER_RESULTS,
  type Relaunch,
  refRow,
  rootRow,
  SHA_A,
  SHA_B,
  singleRowChunks,
} from './support/gitUiPortFixtures';

// P265 Stream C: every chrome string on the git surfaces comes from the catalog. The pseudo-locale
// wraps catalog messages, so a literal shows as a letter outside the markers. Fixture data (ref
// names, shas, people, paths, times) is allowed by pattern.

const GIT_DATA = [
  /\b(port-repo|feature-auth|feature\/example|stacked-branch|main|origin|v1)\b/,
  /\/tmp\/|\.git\b/,
  /[0-9a-f]{7,40}/,
  /Fake (Author|Committer)|@example\.com|Jane Coauthor/,
  /A commit|auth work|a\.ts|README|example\.ts|src\//,
  /Paragraph \d|This paragraph exists|Co-authored-by|Signed-off-by/,
  /\bago\b|\d{4}|\bnow\b|\b\d+\s?(second|minute|hour|day|month|year)s?\b/,
  /^\s*[+-]?\d+\s*$/,
  // Compact ages (`2y`); `connection-state` is a text hook the e2e specs wait on.
  /^\d+[smhdwy]$/,
  /^(connecting|connected|error)$/,
  /^tmp\/$/,
  /^src$/,
];

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const gridRow = (page: Page) =>
  page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"]');

const STATUS = {
  head: { kind: 'branch', name: 'main' },
  upstream: { name: 'origin/main', ahead: 0, behind: 0 },
  counts: { staged: 0, unstaged: 1, untracked: 0, unmerged: 0 },
  isClean: false,
  dirtyPaths: ['a.ts'],
  dirtyTruncated: false,
  inProgress: null,
  autoFetch: null,
};

const REFS = {
  branches: [
    refRow('main', { upstream: 'refs/remotes/origin/main', track: { ahead: 0, behind: 0 } }),
    refRow('feature-auth'),
  ],
  remoteBranches: [
    refRow('origin/main', {
      refname: 'refs/remotes/origin/main',
      kind: 'remoteBranch',
      isHead: false,
    }),
  ],
  tags: [refRow('v1', { refname: 'refs/tags/v1', kind: 'tag' })],
  head: { kind: 'branch', name: 'main' },
};

const SETTINGS = {
  'kiraSpace.graph.pageSize': 500,
  'kiraSpace.graph.scope': 'all',
  'kiraSpace.stash.showInGraph': true,
  'kiraSpace.stash.includeUntracked': false,
  'kiraSpace.review.baseCandidates': ['main'],
  'kiraSpace.pull.strategy': 'auto',
  'kiraSpace.gitHost.provider': 'auto',
  'kiraSpace.worktree.prepareScript': '',
  'kiraSpace.worktree.basePath': '',
  'kiraSpace.checkout.autoStash': true,
};

const RESULTS = {
  ...PICKER_RESULTS,
  'commit.detail': COMMIT_DETAIL,
  'refs.list': REFS,
  'status.get': STATUS,
  'repoSettings.get': SETTINGS,
  'preflight.checkout': {
    target: { kind: 'sha', name: SHA_A },
    detaches: true,
    createsTracking: undefined,
    carried: [],
    blockers: [{ kind: 'blockedByTracked', paths: ['a.ts'] }],
    verdict: 'blocked',
    routes: ['discard', 'stashAndCarry'],
  },
  'preflight.revert': {
    shas: [SHA_A],
    mainlineRequired: [],
    dirtyPaths: [],
    inProgress: null,
    prediction: { kind: 'conflicts', paths: ['a.ts'] },
    predictedFor: SHA_A,
    detachedHead: false,
    verdict: 'willConflict',
    blockers: [],
  },
  'preflight.reset': {
    target: SHA_A,
    targetSubject: 'A commit',
    mode: 'mixed',
    currentHead: SHA_B,
    branch: 'main',
    leaving: 1,
    gaining: 0,
    leavingCommits: [{ sha: SHA_B, subject: 'A later commit' }],
    leavingTruncated: false,
    dirty: { staged: [], unstaged: ['a.ts'], untracked: [] },
    destroys: [],
    inProgress: null,
    requiresTypedConfirmation: false,
    routes: ['stashFirst'],
    verdict: 'clean',
    blockers: [],
  },
  'preflight.cherryPick': {
    sha: SHA_A,
    subject: 'A commit',
    mainlineRequired: [],
    prediction: { kind: 'conflicts', paths: ['a.ts'] },
    alreadyApplied: false,
    inProgress: null,
    detachedHead: false,
    verdict: 'willConflict',
    blockers: [],
  },
  'preflight.worktreeAdd': {
    path: '/tmp/port-repo-worktree',
    mode: 'detach',
    branch: undefined,
    blockers: [],
    notes: [],
    verdict: 'clean',
    routes: [],
  },
  'remote.pushPreflight': {
    upstream: 'origin/main',
    wouldSetUpstream: false,
    ahead: 0,
    behind: 2,
    remoteTip: SHA_B,
    protectedBy: null,
    fastForward: false,
    resolvedBranch: 'main',
  },
  'remote.pullPreflight': {
    strategy: 'merge',
    source: 'default',
    rebaseMerges: false,
    upstream: 'origin/main',
    ahead: 0,
    behind: 1,
    dirty: true,
    routes: [],
    blockers: ['dirtyNonFastForward'],
  },
};

const DECORATED_ROW = rootRow(SHA_A, 'A commit', {
  decoration: [
    { kind: 'branch', name: 'main', isHead: true },
    { kind: 'branch', name: 'feature-auth', isHead: false },
  ],
});

async function openGraph(relaunch: Relaunch): Promise<Page> {
  const page = await openPortGraph(relaunch, {
    chunks: singleRowChunks([DECORATED_ROW]),
    results: RESULTS,
  });
  await expect(gridRow(page)).toBeVisible();
  await setPseudoLocale(page);
  return page;
}

/** The commit's subject sits outside any ref badge, so a right-click there opens the commit menu. */
async function openCommitMenu(page: Page): Promise<void> {
  await gridRow(page).locator('[data-testid="message-subject"]').click({ button: 'right' });
  await expect(tid(page, 'context-menu')).toBeVisible();
}

async function expectDialogCatalog(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expectCatalogText(dialog, { allow: GIT_DATA });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
}

test('graph toolbar uses catalog text', async ({ relaunch }) => {
  const page = await openGraph(relaunch);

  await expect(tid(page, 'fetch-button')).toBeVisible();
  await expectCatalogText(page.locator('[role="toolbar"]'), { allow: GIT_DATA });
});

test('branch picker tabs and row menu use catalog text', async ({ relaunch }) => {
  const page = await openGraph(relaunch);

  await tid(page, 'branch-trigger').click();
  const picker = page.getByRole('dialog');
  await expect(picker).toBeVisible();
  const tabs = tid(page, 'branch-tabs').locator('button');
  await expect(tabs).toHaveCount(5);
  for (let i = 0; i < 5; i++) {
    await tabs.nth(i).click();
    await expectCatalogText(picker, { allow: GIT_DATA });
  }

  await tabs.nth(0).click();
  await page
    .locator('[data-row-id="branch:refs/heads/feature-auth"]')
    .getByRole('button', { name: /More actions/ })
    .click();
  await expect(tid(page, 'context-menu')).toBeVisible();
  await expectCatalogText(tid(page, 'context-menu'), { allow: GIT_DATA });
});

test('commit detail and the row menus use catalog text', async ({ relaunch }) => {
  const page = await openGraph(relaunch);

  await gridRow(page).locator('[data-testid="message-subject"]').click();
  await expect(tid(page, 'meta-subject')).toBeVisible();
  await expectCatalogText(tid(page, 'detail-region'), { allow: GIT_DATA });

  await openCommitMenu(page);
  await expectCatalogText(tid(page, 'context-menu'), { allow: GIT_DATA });
  await page.keyboard.press('Escape');

  await gridRow(page)
    .locator('[data-ref-kind="branch"][data-ref-name="feature-auth"]')
    .click({ button: 'right' });
  await expect(tid(page, 'context-menu')).toBeVisible();
  await expectCatalogText(tid(page, 'context-menu'), { allow: GIT_DATA });
});

// One dialog per commit menu entry: branch, tag, worktree, checkout, revert, reset, cherry-pick.
for (const item of [
  'createBranchHere',
  'createTagHere',
  'createWorktreeHere',
  'checkoutDetached',
  'revertThisCommit',
  'resetToThisCommit',
  'cherryPickThisCommit',
]) {
  test(`commit menu ${item} dialog uses catalog text`, async ({ relaunch }) => {
    const page = await openGraph(relaunch);

    await openCommitMenu(page);
    await tid(page, `menu-item-${item}`).click();
    await expectDialogCatalog(page);
  });
}

test('rename dialog from a ref badge uses catalog text', async ({ relaunch }) => {
  const page = await openGraph(relaunch);

  await gridRow(page)
    .locator('[data-ref-kind="branch"][data-ref-name="feature-auth"]')
    .click({ button: 'right' });
  await tid(page, 'menu-item-renameRef').click();
  await expectDialogCatalog(page);
});

test('stack dialog from the branch picker uses catalog text', async ({ relaunch }) => {
  const page = await openGraph(relaunch);

  await tid(page, 'branch-trigger').click();
  await page
    .locator('[data-row-id="branch:refs/heads/feature-auth"]')
    .getByRole('button', { name: /More actions/ })
    .click();
  await tid(page, 'menu-item-stackSetParent').click();
  const dialogs = page.getByRole('dialog');
  await expect(dialogs.last()).toBeVisible();
  await expectCatalogText(dialogs.last(), { allow: GIT_DATA });
});

test('stash dialog uses catalog text', async ({ relaunch }) => {
  const page = await openGraph(relaunch);

  await tid(page, 'stash-changes-button').click();
  await expectDialogCatalog(page);
});

test('repository settings dialog uses catalog text', async ({ relaunch }) => {
  const page = await openGraph(relaunch);

  await tid(page, 'repo-settings-button').click();
  await expectDialogCatalog(page);
});

test('pull dialog uses catalog text', async ({ relaunch }) => {
  const page = await openGraph(relaunch);

  await tid(page, 'pull-button').click();
  await expectDialogCatalog(page);
});

test('force push dialog uses catalog text', async ({ relaunch }) => {
  const page = await openGraph(relaunch);

  await tid(page, 'push-overflow-trigger').click();
  await page.getByRole('menuitem').first().click();
  await expectDialogCatalog(page);
});

test('review view uses catalog text', async ({ relaunch }) => {
  const page = await openReviewListing(relaunch);
  await setPseudoLocale(page);

  const host = tid(page, 'repo-review-host');
  await expect(host).toBeVisible();
  await expectCatalogText(host, { allow: GIT_DATA });
});
