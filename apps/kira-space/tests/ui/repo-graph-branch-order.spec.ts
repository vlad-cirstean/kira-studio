import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openPortGraph, PORT_REPO, type Relaunch } from './support/gitUiPortFixtures';
import {
  buildForkInterleaveChunk,
  buildForkInterleaveRefsList,
  buildGraphStreamChunk,
  buildMultiBranchChunk,
  buildMultiBranchRefsList,
  FORK_INTERLEAVE_DISPLAY_SUBJECTS,
} from './support/graphStreamFixture';

// Date-ordered layout over the multi-branch fixture: main (3 commits), feature-newer (5,
// collapses by default) and feature-older (2). Display follows store order; no sibling branches
// interleave. Collapsed order: F0 [placeholder] G0 G1 M0 M1 M2 (7 rows); expanded: 10 rows.
// The fork-interleave fixture covers sibling branches that do interleave. The collapse toggle
// itself and the search reveal are covered in repo-workspace.spec.ts.

const grid = '[data-testid="commit-grid"]';

async function bootBranchOrder(relaunch: Relaunch): Promise<Page> {
  const page = await openPortGraph(relaunch, {
    chunks: [buildGraphStreamChunk(PORT_REPO.repoId, 0, buildMultiBranchChunk())],
    results: { 'refs.list': buildMultiBranchRefsList() },
  });
  await expect(page.locator(`${grid} .slick-row[data-row="6"]`)).toBeVisible();
  return page;
}

const messageCell = (p: Page, row: number) =>
  p.locator(`${grid} .slick-row[data-row="${row}"] .kira-cell-message`).first();

const rowPaths = (p: Page, row: number) =>
  p.locator(`${grid} .slick-row[data-row="${row}"] [data-testid="graph-svg"] path`);

const pathCount = (p: Page, row: number) => rowPaths(p, row).count();

test('no dashed fork stubs; the placeholder and G1 connect by lane down to M1 and M2', async ({
  relaunch,
}) => {
  const page = await bootBranchOrder(relaunch);

  await expect(page.locator(`${grid} path[stroke-dasharray]`)).toHaveCount(0);
  // Rows: 0 F0, 1 placeholder, 2 G0, 3 G1, 4 M0, 5 M1, 6 M2.
  await expect(messageCell(page, 5)).toContainText('main M1');
  await expect(messageCell(page, 3)).toContainText('feature-older oldest (G1)');
  await expect(messageCell(page, 6)).toContainText('main root (M2)');
  // The placeholder's lane runs to M1 (rows 2-4 pass through) and G1 runs to M2 (rows 4-5 pass through).
  for (const row of [2, 3, 4]) {
    expect(await pathCount(page, row)).toBeGreaterThanOrEqual(2);
  }
  expect(await pathCount(page, 5)).toBeGreaterThanOrEqual(2);
});

test('a collapsed run shows its tip then the placeholder, never its oldest commit', async ({
  relaunch,
}) => {
  const page = await bootBranchOrder(relaunch);

  await expect(messageCell(page, 0)).toContainText('feature-newer tip (F0)');
  const placeholder = messageCell(page, 1);
  await expect(placeholder).toHaveAttribute('data-testid', 'graph-collapsed-row');
  await expect(placeholder).toContainText('4 more commits on feature-newer');
  await expect(messageCell(page, 2)).toContainText('feature-older tip (G0)');
  await expect(page.locator(grid).getByText('feature-newer oldest (F4)')).toHaveCount(0);
});

test('expanding a collapsed group lists its members in order', async ({ relaunch }) => {
  const page = await bootBranchOrder(relaunch);
  await messageCell(page, 1).click();

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
    await expect(messageCell(page, i)).toContainText(text);
  }
});

test('collapse toggled off lists every row in store order and never overlaps rows', async ({
  relaunch,
}) => {
  const page = await bootBranchOrder(relaunch);
  await page.locator('[data-testid="graph-collapse-toggle"]').click();
  await expect(page.locator(`${grid} .slick-row[data-row="9"]`)).toBeVisible();

  await expect(messageCell(page, 0)).toContainText('feature-newer tip (F0)');
  await expect(messageCell(page, 4)).toContainText('feature-newer oldest (F4)');
  await expect(messageCell(page, 5)).toContainText('feature-older tip (G0)');
  await expect(messageCell(page, 7)).toContainText('main tip (M0)');
  await expect(page.locator(`${grid} path[stroke-dasharray]`)).toHaveCount(0);

  const overflow = await page
    .locator(`${grid} .slick-viewport-top.slick-viewport-left`)
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  const rows = await page.evaluate((sel) => {
    return Array.from(document.querySelectorAll(`${sel} .slick-row`))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          row: Number(el.getAttribute('data-row')),
          top: rect.top,
          bottom: rect.bottom,
        };
      })
      .sort((a, b) => a.row - b.row);
  }, grid);
  expect(rows.length).toBeGreaterThanOrEqual(10);
  for (let i = 1; i < rows.length; i++) {
    expect(rows[i].top).toBeGreaterThanOrEqual(rows[i - 1].bottom - 1);
  }
});

test('sibling branches that interleave render contiguously, each with a real edge to the fork', async ({
  relaunch,
}) => {
  const page = await openPortGraph(relaunch, {
    chunks: [buildGraphStreamChunk(PORT_REPO.repoId, 0, buildForkInterleaveChunk())],
    results: { 'refs.list': buildForkInterleaveRefsList() },
  });
  await page.locator('[data-testid="graph-collapse-toggle"]').click();
  await expect(page.locator(`${grid} .slick-row[data-row="11"]`)).toBeVisible();

  for (const [row, subject] of FORK_INTERLEAVE_DISPLAY_SUBJECTS.entries()) {
    await expect(messageCell(page, row)).toContainText(new RegExp(`\\b${subject}\\b`));
  }
  await expect(page.locator(`${grid} path[stroke-dasharray]`)).toHaveCount(0);

  // x1 (row 7) and f1 (row 9) run down to m1 (row 10) in their own lane.
  for (const [tipRow, lastRow] of [
    [7, 10],
    [9, 10],
  ]) {
    const cx = await page
      .locator(`${grid} .slick-row[data-row="${tipRow}"] [data-testid="graph-svg"] circle`)
      .first()
      .getAttribute('cx');
    const laneStart = new RegExp(`(^|[ M])${cx}[, ]`);
    for (let row = tipRow; row <= lastRow; row++) {
      const ds = await rowPaths(page, row).evaluateAll((els) =>
        els.map((el) => el.getAttribute('d') ?? ''),
      );
      expect(ds.some((d) => laneStart.test(d))).toBe(true);
    }
  }
});
