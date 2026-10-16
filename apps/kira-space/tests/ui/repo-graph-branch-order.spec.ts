import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openPortGraph, PORT_REPO, type Relaunch } from './support/gitUiPortFixtures';
import {
  buildGraphStreamChunk,
  buildMultiBranchChunk,
  buildMultiBranchRefsList,
} from './support/graphStreamFixture';

// Branch-grouped layout over the multi-branch fixture: main (3 commits), feature-newer (5, collapses
// by default) and feature-older (2). Collapsed order: M0 M1 M2 F0 [placeholder] F4 G0 G1 (8 rows);
// expanded: 10 rows. Ported from the VS Code webview suite; the collapse toggle itself and the
// search reveal are covered in repo-workspace.spec.ts.

const grid = '[data-testid="commit-grid"]';

async function bootBranchOrder(relaunch: Relaunch): Promise<Page> {
  const page = await openPortGraph(relaunch, {
    chunks: [buildGraphStreamChunk(PORT_REPO.repoId, 0, buildMultiBranchChunk())],
    results: { 'refs.list': buildMultiBranchRefsList() },
  });
  await expect(page.locator(`${grid} .slick-row[data-row="7"]`)).toBeVisible();
  return page;
}

const messageCell = (p: Page, row: number) =>
  p.locator(`${grid} .slick-row[data-row="${row}"] .kira-cell-message`).first();

const dashedPaths = (p: Page, row: number) =>
  p.locator(
    `${grid} .slick-row[data-row="${row}"] [data-testid="graph-svg"] path[stroke-dasharray]`,
  );

test('each feature branch draws one dashed fork stub on its oldest row', async ({ relaunch }) => {
  const page = await bootBranchOrder(relaunch);

  await expect(page.locator(`${grid} path[stroke-dasharray]`)).toHaveCount(2);
  await expect(dashedPaths(page, 5)).toHaveCount(1); // F4 forks off main
  await expect(dashedPaths(page, 7)).toHaveCount(1); // G1 forks off main
  for (const row of [0, 1, 2, 3, 4, 6]) {
    await expect(dashedPaths(page, row)).toHaveCount(0);
  }
});

test('expanding a collapsed group lists its members in order', async ({ relaunch }) => {
  const page = await bootBranchOrder(relaunch);
  await messageCell(page, 4).click();

  await expect(page.locator(`${grid} .slick-row[data-row="9"]`)).toBeVisible();
  await expect(page.locator('[data-testid="graph-collapsed-row"]')).toHaveCount(0);
  const expected = [
    'feature-newer tip (F0)',
    'feature-newer F1',
    'feature-newer F2',
    'feature-newer F3',
    'feature-newer oldest (F4)',
    'feature-older tip (G0)',
    'feature-older oldest (G1)',
  ];
  for (const [i, text] of expected.entries()) {
    await expect(messageCell(page, 3 + i)).toContainText(text);
  }
});

test('collapse toggled off keeps group order, moves the stubs and never overlaps rows', async ({
  relaunch,
}) => {
  const page = await bootBranchOrder(relaunch);
  await page.locator('[data-testid="graph-collapse-toggle"]').click();
  await expect(page.locator(`${grid} .slick-row[data-row="9"]`)).toBeVisible();

  await expect(messageCell(page, 0)).toContainText('main tip (M0)');
  await expect(messageCell(page, 3)).toContainText('feature-newer tip (F0)');
  await expect(messageCell(page, 7)).toContainText('feature-newer oldest (F4)');
  await expect(messageCell(page, 8)).toContainText('feature-older tip (G0)');
  await expect(page.locator(`${grid} path[stroke-dasharray]`)).toHaveCount(2);
  await expect(dashedPaths(page, 7)).toHaveCount(1);
  await expect(dashedPaths(page, 9)).toHaveCount(1);

  const overflow = await page
    .locator(`${grid} .slick-viewport-top.slick-viewport-left`)
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  const rows = await page.evaluate((sel) => {
    return Array.from(document.querySelectorAll(`${sel} .slick-row`))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return { row: Number(el.getAttribute('data-row')), top: rect.top, bottom: rect.bottom };
      })
      .sort((a, b) => a.row - b.row);
  }, grid);
  expect(rows.length).toBeGreaterThanOrEqual(10);
  for (let i = 1; i < rows.length; i++) {
    expect(rows[i].top).toBeGreaterThanOrEqual(rows[i - 1].bottom - 1);
  }
});
