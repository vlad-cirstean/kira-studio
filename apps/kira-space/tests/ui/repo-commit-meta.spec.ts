import { expect, test } from './fixtures';
import { contract } from './support/contract';
import {
  openCommitDetail,
  openPortGraph,
  rootRow,
  SHA_A,
  singleRowChunks,
} from './support/gitUiPortFixtures';

// The commit detail pane's collapsed and expanded states inside Space, over real rendered
// geometry. Ported from the VS Code webview suite.

test('collapsed, the pane shows the title, a short SHA and Open all changes, and nothing else', async ({
  relaunch,
}) => {
  const page = await openCommitDetail(relaunch);

  await expect(page.locator('[data-testid="open-all-changes-button"]')).toBeVisible();
  await expect(page.locator('[data-testid="commit-meta-sha"]')).toHaveText('2222222');
  await expect(page.locator('[data-testid="meta-body-toggle"]')).toHaveText('Show more');
  await expect(page.locator('[data-testid="meta-body"]')).toBeHidden();
  await expect(page.locator('[data-testid="meta-trailers"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="meta-identity"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="meta-refs"]')).toHaveCount(0);
  await expect(
    page.locator(
      '[data-testid="meta-sha-row"], [data-testid="meta-parents"], [data-testid="meta-parent"]',
    ),
  ).toHaveCount(0);

  const { pane, tree } = await page.evaluate(() => {
    const height = (sel: string) =>
      document.querySelector(sel)?.getBoundingClientRect().height ?? 0;
    return {
      pane: height('[data-testid="detail-pane"]'),
      tree: height('[data-testid="file-tree"]'),
    };
  });
  expect(pane).toBeGreaterThan(0);
  expect(tree / pane).toBeGreaterThanOrEqual(0.75);
});

test('Show more reveals the full body, trailers, identities and refs, and the pane scrolls', async ({
  relaunch,
}) => {
  const page = await openCommitDetail(relaunch);
  const meta = page.locator('[data-testid="commit-meta"]');
  const collapsedHeight = await meta.evaluate((el) => el.clientHeight);

  const toggle = page.locator('[data-testid="meta-body-toggle"]');
  await toggle.click();
  await expect(toggle).toHaveText('Show less');

  const body = page.locator('[data-testid="meta-body"]');
  await expect(body).toBeVisible();
  const { scrollHeight, clientHeight } = await body.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(clientHeight).toBe(scrollHeight);

  const trailers = page.locator('[data-testid="meta-trailers"]');
  await expect(trailers).toContainText('Co-authored-by');
  await expect(trailers).toContainText('Jane Coauthor');
  await expect(trailers).toContainText('Signed-off-by');
  const identity = page.locator('[data-testid="meta-identity"]');
  await expect(identity).toHaveCount(2);
  await expect(identity.first()).toContainText('Fake Author');
  await expect(identity.last()).toContainText('Fake Committer');
  await expect(page.locator('dt', { hasText: 'Refs' })).toBeVisible();
  await expect(page.locator('[data-testid="meta-refs"]')).toContainText('main');
  await expect(page.locator('[data-testid="commit-meta-sha"]')).toHaveText('2222222');

  // The meta root grows; the scroll container is the inner body wrapper (f046f9a12).
  const expandedHeight = await meta.evaluate((el) => el.clientHeight);
  expect(expandedHeight).toBeGreaterThan(collapsedHeight);
  const scroller = page.locator('[data-testid="meta-body"]').locator('xpath=..');
  expect(await scroller.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');
});

test('the view head and the detail head are Studio 34px toolbars', async ({ relaunch }) => {
  const page = await openCommitDetail(relaunch);
  const viewHead = page.locator('[data-testid="git-view-head"]');
  await expect(viewHead).toBeVisible();
  await expect(page.locator('[data-testid="git-view-head-branch"]')).toBeVisible();
  const detailHead = page.locator('[data-testid="detail-head"]');
  await expect(detailHead).toBeVisible();
  for (const head of [viewHead, detailHead]) {
    expect(await head.evaluate((el) => el.getBoundingClientRect().height)).toBe(34);
  }
});

// Contracts git-remote (refs.list#behind) and git-view-head (status.get#cherry-pick). Backend
// halves: gitflow TestRemoteFetchPullPush and TestCherryPickRevertConflict.
test('contract: the view head shows the branch, its behind count and the operation in progress', async ({
  relaunch,
}) => {
  const refs = contract<{
    branches: { shortName: string; isHead: boolean; track?: { ahead: number; behind: number } }[];
  }>('git-remote', 'git:refs.list#behind');
  const head = refs.branches.find((b) => b.isHead);
  if (!head?.track) throw new Error('contract lost the head branch tracking');
  const status = contract<{ inProgress: { kind: string } }>(
    'git-view-head',
    'git:status.get#cherry-pick',
  );
  expect(status.inProgress.kind).toBe('cherryPick');
  const page = await openPortGraph(relaunch, {
    chunks: singleRowChunks([rootRow(SHA_A, 'Add the graph column fixture')]),
    results: { 'refs.list': refs, 'status.get': status },
  });
  await expect(page.locator('[data-testid="git-view-head-branch"]')).toHaveText(head.shortName);
  await expect(page.locator('[data-testid="git-view-head-sync"]')).toContainText(
    `\u2193${head.track.behind}`,
  );
  await expect(page.locator('[data-testid="git-view-head-operation"]')).toContainText(
    'Cherry-picking',
  );
});
