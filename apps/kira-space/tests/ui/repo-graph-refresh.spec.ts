import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
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
  await expect(row(page, 0)).toBeVisible();
  return page;
}

test('refsChanged for the open repo refreshes the graph; other kinds and other repos do not', async ({
  relaunch,
}) => {
  const page = await bootOne(relaunch);
  const before = await refreshes(page);

  await gitStreamEmit(page, 'repo.changed', { repoId: PORT_REPO.repoId, kind: 'worktreeChanged' });
  await gitStreamEmit(page, 'repo.changed', { repoId: '/tmp/elsewhere', kind: 'refsChanged' });
  // Past the 250ms coalesce window: there is no signal that nothing will happen.
  await page.waitForTimeout(600);
  expect(await refreshes(page)).toBe(before);

  await gitStreamEmit(page, 'repo.changed', { repoId: PORT_REPO.repoId, kind: 'refsChanged' });
  await expect.poll(() => refreshes(page), { timeout: 1000 }).toBe(before + 1);
});

test('a refresh keeps the scroll position', async ({ relaunch }) => {
  const page = await openPortGraph(relaunch, {
    chunks: singleRowChunks(manyRows(300)),
    results: { 'refs.list': refsAtTip(manyRowShas(0)) },
  });
  await expect(row(page, 0)).toBeVisible();
  await expect
    .poll(() => viewport(page).evaluate((el) => el.scrollHeight > el.clientHeight * 4), {
      timeout: 15_000,
    })
    .toBe(true);
  await viewport(page).evaluate((el) => {
    el.scrollTop = 2000;
  });
  await expect.poll(() => viewport(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(1500);
  const before = await viewport(page).evaluate((el) => el.scrollTop);
  const calls = await refreshes(page);

  await gitStreamEmit(page, 'repo.changed', { repoId: PORT_REPO.repoId, kind: 'refsChanged' });
  await expect.poll(() => refreshes(page), { timeout: 1000 }).toBe(calls + 1);

  const rowHeight = 28;
  await expect
    .poll(async () => Math.abs((await viewport(page).evaluate((el) => el.scrollTop)) - before), {
      timeout: 5000,
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

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

test('a restored scrollRow of 0 does not crash a grid that mounts before its first chunk', async ({
  relaunch,
}) => {
  const page = await restorePortGraph(
    relaunch,
    persistedViewState(0),
    singleRowChunks([rootRow(SHA_A, 'Add the graph column fixture')]),
  );
  const errors = trackErrors(page);
  await expect(row(page, 0)).toBeVisible();
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
  await expect(page.locator(`${grid} .slick-row`).first()).toBeVisible();
  await expect
    .poll(() => viewport(page).evaluate((el) => el.scrollHeight > el.clientHeight), {
      timeout: 5000,
    })
    .toBe(true);
  await expect
    .poll(() => viewport(page).evaluate((el) => el.scrollTop), { timeout: 5000 })
    .toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
