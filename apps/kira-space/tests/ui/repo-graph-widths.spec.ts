import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  chunkedRows,
  manyRowShas,
  persistedViewState,
  realisticRows,
  refsAtTip,
  restorePortGraph,
} from './support/gitUiPortFixtures';

// Column widths: a persisted layout is restored as saved, every drag handle sits on its cell
// boundary, a drag moves exactly that boundary, and the grid never grows a horizontal scroll.

const grid = '[data-testid="commit-grid"]';
const SAVED = { author: 180, date: 130, graph: 110 };

async function boot(relaunch: Parameters<typeof restorePortGraph>[0]): Promise<Page> {
  const page = await restorePortGraph(
    relaunch,
    { ...persistedViewState(0), columnWidths: SAVED },
    chunkedRows(realisticRows(80), 80),
    { 'refs.list': refsAtTip(manyRowShas(0)) },
  );
  await page.setViewportSize({ width: 1280, height: 760 });
  await expect(page.locator(`${grid} .slick-row[data-row="12"]`)).toBeVisible();
  return page;
}

/** Left edges and widths of the four cells of row 0, in column order. */
const cells = (page: Page) =>
  page.evaluate(() =>
    Array.from(
      document.querySelectorAll(`[data-testid="commit-grid"] .slick-row[data-row="0"] .slick-cell`),
    ).map((el) => {
      const box = el.getBoundingClientRect();
      return { left: box.left, width: box.width };
    }),
  );

const handleCenter = async (page: Page, name: string): Promise<number> => {
  const box = await page.getByRole('separator', { name }).boundingBox();
  if (!box) throw new Error(`${name}: no handle box`);
  return box.x + box.width / 2;
};

async function expectLayoutConsistent(page: Page): Promise<void> {
  const [graph, message, author, date] = await cells(page);
  expect(graph.left + graph.width).toBeCloseTo(message.left, 0);
  expect(message.left + message.width).toBeCloseTo(author.left, 0);
  expect(author.left + author.width).toBeCloseTo(date.left, 0);
  expect(Math.abs((await handleCenter(page, 'Resize graph column')) - message.left)).toBeLessThan(
    3,
  );
  expect(Math.abs((await handleCenter(page, 'Resize author column')) - author.left)).toBeLessThan(
    3,
  );
  expect(Math.abs((await handleCenter(page, 'Resize date column')) - date.left)).toBeLessThan(3);
  const overflow = await page
    .locator(`${grid} .slick-viewport-top.slick-viewport-left`)
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Drags a handle by `dx` and returns where it ended; it must follow the pointer. */
async function drag(page: Page, name: string, dx: number): Promise<void> {
  const box = await page.getByRole('separator', { name }).boundingBox();
  if (!box) throw new Error(`${name}: no handle box`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 6 });
  await page.mouse.up();
  expect(Math.abs((await handleCenter(page, name)) - (x + dx))).toBeLessThan(3);
}

test('saved column widths are restored and every handle sits on its cell boundary', async ({
  relaunch,
}) => {
  const page = await boot(relaunch);
  const [, , author, date] = await cells(page);
  expect(Math.round(author.width)).toBe(SAVED.author);
  expect(Math.round(date.width)).toBe(SAVED.date);
  await expectLayoutConsistent(page);
});

test('dragging the author, date and graph handles moves that boundary with the pointer', async ({
  relaunch,
}) => {
  const page = await boot(relaunch);

  const before = await cells(page);
  await drag(page, 'Resize author column', -40);
  const afterAuthor = await cells(page);
  expect(Math.round(afterAuthor[2].width - before[2].width)).toBe(40);
  expect(Math.round(afterAuthor[3].width)).toBe(Math.round(before[3].width));
  await expectLayoutConsistent(page);

  await drag(page, 'Resize date column', -30);
  const afterDate = await cells(page);
  expect(Math.round(afterDate[3].width - afterAuthor[3].width)).toBe(30);
  await expectLayoutConsistent(page);

  await drag(page, 'Resize graph column', 25);
  const afterGraph = await cells(page);
  expect(Math.round(afterGraph[0].width - afterDate[0].width)).toBe(25);
  await expectLayoutConsistent(page);
});
