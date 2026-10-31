import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { freezeClock, runCoalesceWindow } from './support/clock';
import { contract } from './support/contract';
import { gitStreamEmit, gitStreamRequests } from './support/gitStreamMock';
import {
  manyRowShas,
  manyRows,
  openPortGraph,
  PORT_REPO,
  persistedViewState,
  type Relaunch,
  refsAtTip,
  restorePortGraph,
  rootRow,
  SHA_A,
  singleRowChunks,
} from './support/gitUiPortFixtures';
import { trackErrors } from './support/pageErrors';

// How the shared git-ui graph reacts to daemon events and restored state inside Space: which
// repo.changed kinds refresh, what a refresh does to scroll and menus, and the stopped auto-fetch
// event. Ported from the VS Code webview suite.

const grid = '[data-testid="commit-grid"]';
const row = (p: Page, n: number) => p.locator(`${grid} .slick-row[data-row="${n}"]`);
const viewport = (p: Page) => p.locator(`${grid} .slick-viewport-top.slick-viewport-left`);
const refreshes = async (p: Page) =>
  (await gitStreamRequests(p)).filter((m) => m === 'graph.refresh').length;

async function bootOne(relaunch: Relaunch) {
  const page = await openPortGraph(relaunch, {
    chunks: singleRowChunks([rootRow(SHA_A, 'Add the graph column fixture')]),
  });
  await expect(row(page, 0)).toBeVisible({ timeout: 15_000 });
  return page;
}

test('refsChanged for the open repo refreshes the graph; other kinds and other repos do not', async ({
  relaunch,
}) => {
  const page = await bootOne(relaunch);
  const before = await refreshes(page);
  await freezeClock(page);

  await gitStreamEmit(page, 'repo.changed', { repoId: PORT_REPO.repoId, kind: 'worktreeChanged' });
  await gitStreamEmit(page, 'repo.changed', { repoId: '/tmp/elsewhere', kind: 'refsChanged' });
  await runCoalesceWindow(page);
  expect(await refreshes(page)).toBe(before);

  await gitStreamEmit(page, 'repo.changed', { repoId: PORT_REPO.repoId, kind: 'refsChanged' });
  await runCoalesceWindow(page);
  await expect.poll(() => refreshes(page), { timeout: 15_000 }).toBe(before + 1);
});

test('a refresh keeps the scroll position', async ({ relaunch }) => {
  const page = await openPortGraph(relaunch, {
    chunks: singleRowChunks(manyRows(300)),
    results: { 'refs.list': refsAtTip(manyRowShas(0)) },
  });
  await expect(row(page, 0)).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => viewport(page).evaluate((el) => el.scrollHeight > el.clientHeight * 4), {
      timeout: 15_000,
    })
    .toBe(true);
  await viewport(page).evaluate((el) => {
    el.scrollTop = 2000;
  });
  await expect.poll(() => viewport(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(1500);
  // The grid reports its viewport only once it repainted at the new offset; refreshing earlier
  // captures the old top row and the restore pins it back to the start.
  await expect(row(page, 0)).toHaveCount(0);
  const before = await viewport(page).evaluate((el) => el.scrollTop);
  const calls = await refreshes(page);

  await freezeClock(page);
  await gitStreamEmit(page, 'repo.changed', { repoId: PORT_REPO.repoId, kind: 'refsChanged' });
  await runCoalesceWindow(page);
  await expect.poll(() => refreshes(page), { timeout: 15_000 }).toBe(calls + 1);

  const rowHeight = 28;
  await expect
    .poll(async () => Math.abs((await viewport(page).evaluate((el) => el.scrollTop)) - before), {
      timeout: 15_000,
    })
    .toBeLessThanOrEqual(rowHeight);
});

test('a refresh mid-menu closes the commit context menu', async ({ relaunch }) => {
  const page = await bootOne(relaunch);
  await row(page, 0).click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();

  await gitStreamEmit(page, 'repo.changed', { repoId: PORT_REPO.repoId, kind: 'refsChanged' });
  await expect(menu).toBeHidden();
});

test('an autoFetch.changed event raises and clears the stopped marker', async ({ relaunch }) => {
  const page = await bootOne(relaunch);
  const marker = page.locator('[data-testid="autofetch-stopped"]');
  await expect(marker).toHaveCount(0);

  await gitStreamEmit(page, 'autoFetch.changed', {
    repoId: PORT_REPO.repoId,
    autoFetch: { state: 'stopped', kind: 'AuthFailed', message: 'denied', at: 1 },
  });
  await expect(marker).toBeVisible();

  await gitStreamEmit(page, 'autoFetch.changed', { repoId: PORT_REPO.repoId, autoFetch: null });
  await expect(marker).toHaveCount(0);
});

test('a restored scrollRow of 0 does not crash a grid that mounts before its first chunk', async ({
  relaunch,
}) => {
  const page = await restorePortGraph(
    relaunch,
    persistedViewState(0),
    singleRowChunks([rootRow(SHA_A, 'Add the graph column fixture')]),
  );
  const errors = trackErrors(page);
  await expect(row(page, 0)).toBeVisible({ timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('a restored scrollRow beyond the history clamps to the last row', async ({ relaunch }) => {
  const page = await restorePortGraph(
    relaunch,
    persistedViewState(999_999),
    singleRowChunks(manyRows(300)),
    { 'refs.list': refsAtTip(manyRowShas(0)) },
  );
  const errors = trackErrors(page);
  await expect(page.locator(`${grid} .slick-row`).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(() => viewport(page).evaluate((el) => el.scrollHeight > el.clientHeight), {
      timeout: 15_000,
    })
    .toBe(true);
  await expect
    .poll(() => viewport(page).evaluate((el) => el.scrollTop), { timeout: 15_000 })
    .toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

// Contract git-remote. Backend half: gitflow TestRemoteFetchPullPush. After a fetch the branch is
// behind by one; the picker marks the branch row with the ahead/behind counts.
test('contract: the branch picker marks a branch behind its upstream', async ({ relaunch }) => {
  const refs = contract<{
    branches: { shortName: string; track?: { ahead: number; behind: number } }[];
  }>('git-remote', 'git:refs.list#behind');
  const main = refs.branches.find((b) => b.shortName === 'main');
  if (!main?.track) throw new Error('contract lost the tracking counts');
  const page = await openPortGraph(relaunch, {
    chunks: singleRowChunks([rootRow(SHA_A, 'Add the graph column fixture')]),
    results: { 'refs.list': refs },
  });
  await expect(row(page, 0)).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-testid="branch-trigger"]').click();
  const branchRow = page.locator('[data-testid="branch-row-main"]', { hasText: 'main' }).first();
  await expect(branchRow).toContainText(`\u2193${main.track.behind}`);
});
