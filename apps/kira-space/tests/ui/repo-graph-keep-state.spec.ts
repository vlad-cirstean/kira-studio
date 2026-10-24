import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { freezeClock, runCoalesceWindow } from './support/clock';
import { gitStreamEmit, gitStreamRequests } from './support/gitStreamMock';
import {
  manyRowShas,
  manyRows,
  openPortGraph,
  PORT_REPO,
  type Relaunch,
  refsAtTip,
  singleRowChunks,
} from './support/gitUiPortFixtures';
import { IPC } from './support/ipcChannels';
import { trackErrors } from './support/pageErrors';
import { repoTab, treeRow } from './support/repoRows';
import type { ControlSnapshot } from './support/types';

// The pinned graph tab stays mounted (hidden) while another tab is active: opening a diff and
// returning must not re-walk the graph or lose scroll/selection.

const grid = '[data-testid="commit-grid"]';
const row = (p: Page, n: number) => p.locator(`${grid} .slick-row[data-row="${n}"]`);
const viewport = (p: Page) => p.locator(`${grid} .slick-viewport-top.slick-viewport-left`);
const count = async (p: Page, method: string) =>
  (await gitStreamRequests(p)).filter((m) => m === method).length;

const CONTROL: ControlSnapshot[] = [
  { channel: IPC.codeWorkspaceListRepos, response: [PORT_REPO] },
  {
    channel: IPC.codeWorkspaceListFiles,
    args: { id: PORT_REPO.id },
    response: { paths: ['a.ts', 'c.ts'], status: { 'c.ts': 'M' }, truncated: false },
  },
  {
    channel: IPC.codeWorkspaceReadDiff,
    args: { id: PORT_REPO.id, path: 'c.ts' },
    response: {
      path: 'c.ts',
      language: 'typescript',
      head: {
        kind: 'found',
        text: 'export const c = 1;\n',
        bytes: 20,
        limitBytes: 8 * 1024 * 1024,
      },
      worktree: {
        kind: 'found',
        text: 'export const c = 2;\n',
        bytes: 20,
        limitBytes: 8 * 1024 * 1024,
      },
    },
  },
];

async function boot(relaunch: Relaunch): Promise<Page> {
  const page = await openPortGraph(relaunch, {
    chunks: singleRowChunks(manyRows(300)),
    results: { 'refs.list': refsAtTip(manyRowShas(0)) },
    control: CONTROL,
  });
  await expect(row(page, 0)).toBeVisible();
  await expect
    .poll(() => viewport(page).evaluate((el) => el.scrollHeight > el.clientHeight * 4), {
      timeout: 15_000,
    })
    .toBe(true);
  return page;
}

async function openDiff(page: Page): Promise<void> {
  await page.locator('[data-testid="git-panel-tab-files"]').click();
  await treeRow(page, 'c.ts').click({ button: 'right' });
  await page.locator('[data-testid="menu-item-open-changes"]').click();
  await expect(page.locator('[data-testid="repo-diff-editor"]')).toBeVisible();
  await expect(page.locator('[data-testid="repo-graph-host"]')).toBeHidden();
}

const tag = (p: Page) =>
  p.locator(grid).evaluate((el) => {
    (el as HTMLElement).dataset.p342 = 'kept';
  });

test('opening a diff and returning keeps the graph mounted with scroll and selection', async ({
  relaunch,
}) => {
  const page = await boot(relaunch);
  const errors = trackErrors(page);
  await viewport(page).evaluate((el) => {
    el.scrollTop = 2000;
  });
  await expect.poll(() => viewport(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(1500);
  const saved = await viewport(page).evaluate((el) => el.scrollTop);
  const selected = page.locator(`${grid} .slick-row[aria-selected="true"]`);
  const visibleRow = page.locator(`${grid} .slick-row`).nth(3);
  await visibleRow.click();
  await expect(selected.first()).toBeVisible();
  await tag(page);
  const before = {
    init: await count(page, 'app.init'),
    stream: await count(page, 'graph.stream'),
    refresh: await count(page, 'graph.refresh'),
  };

  await openDiff(page);
  await repoTab(page, 'repo-graph').click();

  await expect(page.locator(grid)).toHaveAttribute('data-p342', 'kept');
  expect(await count(page, 'app.init')).toBe(before.init);
  expect(await count(page, 'graph.stream')).toBe(before.stream);
  expect(await count(page, 'graph.refresh')).toBe(before.refresh);
  await expect
    .poll(async () => Math.abs((await viewport(page).evaluate((el) => el.scrollTop)) - saved), {
      timeout: 5000,
    })
    .toBeLessThanOrEqual(28);
  await expect(selected.first()).toBeVisible();
  await expect(page.locator('[data-testid="boot-error"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a refresh while the graph is hidden updates in place', async ({ relaunch }) => {
  const page = await boot(relaunch);
  await tag(page);
  await openDiff(page);
  const init = await count(page, 'app.init');
  const stream = await count(page, 'graph.stream');
  const refresh = await count(page, 'graph.refresh');

  await freezeClock(page);
  await gitStreamEmit(page, 'repo.changed', { repoId: PORT_REPO.repoId, kind: 'refsChanged' });
  await runCoalesceWindow(page);
  await expect.poll(() => count(page, 'graph.refresh'), { timeout: 1000 }).toBe(refresh + 1);

  await repoTab(page, 'repo-graph').click();
  await expect(page.locator(grid)).toHaveAttribute('data-p342', 'kept');
  await expect(row(page, 0)).toBeVisible();
  expect(await count(page, 'app.init')).toBe(init);
  expect(await count(page, 'graph.stream')).toBe(stream);
});

test('closing the workspace unmounts the kept graph; reopening mounts cold', async ({
  relaunch,
}) => {
  const page = await boot(relaunch);
  const errors = trackErrors(page);
  await tag(page);
  await openDiff(page);

  await page.locator('[data-testid="git-panel-tab-repos"]').click();
  await page
    .locator(`[data-testid="repo-row"][data-repo-id="${PORT_REPO.id}"]`)
    .click({ button: 'right' });
  await page.locator('[data-testid="menu-item-close"]').click();
  await expect(page.locator('[data-testid="git-start"]')).toBeVisible();
  await expect(page.locator('[data-testid="repo-graph-host"]')).toHaveCount(0);

  await page.locator(`[data-testid="repo-row"][data-repo-id="${PORT_REPO.id}"]`).click();
  await expect(
    page.locator('[data-testid="repo-graph-host"] [data-testid="connection-state"]'),
  ).toHaveText('connected');
  await expect(page.locator(grid)).not.toHaveAttribute('data-p342', 'kept');
  expect(errors).toEqual([]);
});
