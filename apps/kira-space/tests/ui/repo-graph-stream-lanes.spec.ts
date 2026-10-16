import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { gitStreamEmit, gitStreamReleaseNext } from './support/gitStreamMock';
import {
  chunkedRows,
  manyRowShas,
  openPortGraph,
  PORT_CONTROL,
  PORT_REPO,
  realisticRows,
  refsAtTip,
} from './support/gitUiPortFixtures';

// While a long history streams in, no row may paint before its lanes exist: the plan and its
// layout land together, so a rendered row always draws its node.

const grid = '[data-testid="commit-grid"]';
const TOTAL = 1500;
const CHUNK = 250;

test('rows never render without their lanes while later chunks keep streaming in', async ({
  relaunch,
}) => {
  const page = await openPortGraph(relaunch, {
    control: PORT_CONTROL,
    chunks: chunkedRows(realisticRows(TOTAL), CHUNK),
    holdAfter: 1,
    results: { 'refs.list': refsAtTip(manyRowShas(0)) },
  });
  await page.setViewportSize({ width: 1280, height: 760 });
  await expect(page.locator(`${grid} .slick-row[data-row="0"]`)).toBeVisible();

  await page.evaluate(() => {
    const w = window as unknown as { __laneless: number; __rowsSeen: number };
    w.__laneless = 0;
    w.__rowsSeen = 0;
    const check = (node: Node): void => {
      if (!(node instanceof Element)) return;
      for (const svg of node.matches('[data-testid="graph-svg"]')
        ? [node]
        : Array.from(node.querySelectorAll('[data-testid="graph-svg"]'))) {
        w.__rowsSeen++;
        if (!svg.querySelector('circle')) w.__laneless++;
      }
    };
    new MutationObserver((records) => {
      for (const record of records) for (const added of record.addedNodes) check(added);
    }).observe(document.querySelector('[data-testid="commit-grid"]') as Element, {
      childList: true,
      subtree: true,
    });
  });

  const viewport = page.locator(`${grid} .slick-viewport-top.slick-viewport-left`);
  let height = await viewport.evaluate((el) => el.scrollHeight);
  for (let released = 1; released < TOTAL / CHUNK; released++) {
    await gitStreamReleaseNext(page);
    if (released === 3) {
      await gitStreamEmit(page, 'repo.changed', {
        repoId: PORT_REPO.repoId,
        kind: 'refsChanged',
      });
    }
    await expect
      .poll(() => viewport.evaluate((el) => el.scrollHeight), { timeout: 5000 })
      .toBeGreaterThan(height);
    height = await viewport.evaluate((el) => el.scrollHeight);
  }

  await expectAllRenderedRowsHaveLanes(page);
  const { laneless, seen } = await page.evaluate(() => {
    const w = window as unknown as { __laneless: number; __rowsSeen: number };
    return { laneless: w.__laneless, seen: w.__rowsSeen };
  });
  expect(seen).toBeGreaterThan(0);
  expect(laneless).toBe(0);
});

async function expectAllRenderedRowsHaveLanes(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const svgs = document.querySelectorAll(
            `${'[data-testid="commit-grid"]'} [data-testid="graph-svg"]`,
          );
          return svgs.length > 0 && Array.from(svgs).every((svg) => svg.querySelector('circle'));
        }),
      { timeout: 10_000 },
    )
    .toBe(true);
}
