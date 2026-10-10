import type { Page } from '@playwright/test';
import { defaultSettings } from '../../frontend/src/state/settingsDomain';
import { expect, test } from './fixtures';
import { gitStreamRelease } from './support/gitStreamMock';
import {
  manyRowShas,
  manyRows,
  openPortGraph,
  PORT_CONTROL,
  type Relaunch,
  refsAtTip,
  rootRow,
  SHA_A,
  SHA_B,
  singleRowChunks,
} from './support/gitUiPortFixtures';
import { IPC } from './support/ipcChannels';

// Grid-shape facts the shared git-ui grid must keep inside Space: column set, row geometry, the
// compact detail layout, scrollbars and tab order. Ported from the VS Code webview suite.

const grid = '[data-testid="commit-grid"]';
const row = (p: Page, n: number) => p.locator(`${grid} .slick-row[data-row="${n}"]`);
const detail = (p: Page) => p.locator('[data-testid="detail-region"]');

/** Closes the detail pane; a lone Escape sent before the pane opens is lost, so retry. */
async function closeDetail(p: Page): Promise<void> {
  await expect(async () => {
    await p.keyboard.press('Escape');
    await expect(detail(p)).toHaveCount(0, { timeout: 1000 });
  }).toPass();
}

async function bootGrid(
  relaunch: Relaunch,
  rows: Parameters<typeof singleRowChunks>[0],
  options: { holdAfter?: number; tip?: string; control?: typeof PORT_CONTROL } = {},
): Promise<Page> {
  const page = await openPortGraph(relaunch, {
    control: options.control,
    chunks: singleRowChunks(rows),
    holdAfter: options.holdAfter,
    results: options.tip ? { 'refs.list': refsAtTip(options.tip) } : undefined,
  });
  await expect(row(page, 0)).toBeVisible();
  await closeDetail(page);
  return page;
}

const ONE = [rootRow(SHA_A, 'Add the graph column fixture')];
const TAGGED = [
  rootRow(SHA_A, 'Add the graph column fixture'),
  rootRow(SHA_B, 'A second commit', { decoration: [{ kind: 'tag', name: 'v1' }] }),
];

test('the grid has the four columns and no SHA cell, and the date column fits its widest rendering', async ({
  relaunch,
}) => {
  const page = await bootGrid(relaunch, ONE);

  const headers = page.locator(`${grid} .slick-header-column`);
  await expect(headers).toHaveCount(4);
  const ids = await headers.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-id')));
  expect(new Set(ids)).toEqual(new Set(['graph', 'message', 'author', 'date']));
  await expect(page.locator('.kv-cell-sha')).toHaveCount(0);
  await expect(row(page, 0).locator('.kv-cell-message')).toContainText(
    'Add the graph column fixture',
  );

  const { cellWidth, widest } = await row(page, 0)
    .locator('.kv-cell-date')
    .first()
    .evaluate((span) => {
      const cell = span.closest('.slick-cell');
      if (!cell) throw new Error('.kv-cell-date has no ancestor .slick-cell');
      const style = getComputedStyle(span);
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) throw new Error('2d canvas context unavailable');
      ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}/${style.lineHeight} ${style.fontFamily}`;
      return {
        cellWidth: cell.getBoundingClientRect().width,
        widest: ctx.measureText('2024-12-30 22:48').width,
      };
    });
  expect(cellWidth).toBeGreaterThanOrEqual(widest);
});

test('a decorated row is taller, and each row graph node sits on its own subject line', async ({
  relaunch,
}) => {
  const page = await bootGrid(relaunch, TAGGED);
  await expect(row(page, 1)).toBeVisible();

  const height = (n: number) => row(page, n).evaluate((el) => el.getBoundingClientRect().height);
  expect(await height(1)).toBeGreaterThan(await height(0));

  for (const n of [0, 1]) {
    const { nodeY, subjectY } = await page.evaluate((index) => {
      const rowEl = document.querySelector(
        `[data-testid="commit-grid"] .slick-row[data-row="${index}"]`,
      );
      const circle = rowEl?.querySelector('.kv-graph-svg circle');
      const subject = rowEl?.querySelector('.kv-message-subject');
      if (!rowEl || !circle || !subject) throw new Error(`row ${index}: missing element`);
      const rowTop = rowEl.getBoundingClientRect().top;
      const box = subject.getBoundingClientRect();
      return {
        nodeY: rowTop + Number(circle.getAttribute('cy')),
        subjectY: box.top + box.height / 2,
      };
    }, n);
    expect(Math.abs(nodeY - subjectY)).toBeLessThanOrEqual(2);
  }
});

test('Git graph font size scales grid text and decorated row height', async ({ relaunch }) => {
  const page = await bootGrid(relaunch, TAGGED, {
    control: [
      ...PORT_CONTROL,
      {
        channel: IPC.settingsGetAll,
        response: { ...defaultSettings, git: { ...defaultSettings.git, graphFontSize: 20 } },
      },
    ],
  });
  await expect(row(page, 1)).toBeVisible();

  const fontSize = await row(page, 0)
    .locator('.kv-cell-message')
    .evaluate((el) => getComputedStyle(el).fontSize);
  expect(fontSize).toBe('20px');
  // compact = max(row-height 28, h-xs 25 + 2), decorated = compact + h-xs (13px default gives 45).
  const height = await row(page, 1).evaluate((el) => el.getBoundingClientRect().height);
  expect(height).toBe(53);
});

test('a tag badge is a translucent tint with a coloured border and a matching icon', async ({
  relaunch,
}) => {
  const page = await bootGrid(relaunch, TAGGED);
  const badge = row(page, 1).locator('.kv-badge-tag').first();
  await expect(badge).toBeVisible();

  const style = await badge.evaluate((el) => {
    const css = getComputedStyle(el);
    const icon = el.querySelector('.kv-badge-icon');
    if (!icon) throw new Error('.kv-badge-tag has no .kv-badge-icon');
    return {
      bg: css.backgroundColor,
      border: css.borderColor,
      color: css.color,
      icon: getComputedStyle(icon).color,
    };
  });
  expect(style.bg).toMatch(/\/ 0\.15\)$|,\s*0\.15\)$/);
  expect(style.border).not.toMatch(/^(rgba\(0,\s*0,\s*0,\s*0\)|transparent)$/);
  expect(style.icon).toBe(style.color);
});

test('one click opens the detail pane, a second on the same row closes it', async ({
  relaunch,
}) => {
  const page = await bootGrid(relaunch, ONE);
  await row(page, 0).click();
  await expect(detail(page)).toBeVisible();
  await row(page, 0).click();
  await expect(detail(page)).toHaveCount(0);
});

test('every cell shows a pointer cursor, and clicking the date cell leaves its text alone', async ({
  relaunch,
}) => {
  const page = await bootGrid(relaunch, ONE);
  await expect(row(page, 0)).toHaveCSS('cursor', 'pointer');
  await expect(row(page, 0).locator('.kv-cell-message').first()).toHaveCSS('cursor', 'pointer');
  const date = row(page, 0).locator('.kv-cell-date').first();
  await expect(date).toHaveCSS('cursor', 'pointer');
  const before = await date.textContent();

  await date.click();
  await expect(detail(page)).toBeVisible();
  await row(page, 0).click();
  await expect(detail(page)).toHaveCount(0);
  await expect(row(page, 0).locator('.kv-cell-date').first()).toHaveText(before ?? '');
});

test('with the detail pane open the grid keeps graph and message, and the message takes the rest', async ({
  relaunch,
}) => {
  const page = await bootGrid(relaunch, ONE);
  await row(page, 0).click();
  await expect(detail(page)).toBeVisible();

  const headers = page.locator(`${grid} .slick-header-column`);
  await expect(headers).toHaveCount(2);
  const ids = await headers.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-id')));
  expect(new Set(ids)).toEqual(new Set(['graph', 'message']));

  const { host, graph, message } = await page.evaluate(() => {
    const width = (sel: string) =>
      document
        .querySelector(`[data-testid="commit-grid"] .slick-row[data-row="0"] ${sel}`)
        ?.closest('.slick-cell')
        ?.getBoundingClientRect().width ?? 0;
    const hostEl = document.querySelector('[data-testid="commit-grid"] .kv-grid-host');
    return {
      host: hostEl?.clientWidth ?? 0,
      graph: width('.kv-cell-graph'),
      message: width('.kv-cell-message'),
    };
  });
  expect(host - graph - message).toBeLessThanOrEqual(4);
});

test('a tall grid never grows a horizontal scrollbar, open or closed, and keeps one tabbable row', async ({
  relaunch,
}) => {
  const page = await bootGrid(relaunch, manyRows(300), { tip: manyRowShas(0) });
  const viewport = page.locator(`${grid} .slick-viewport-top.slick-viewport-left`);
  await expect
    .poll(() => viewport.evaluate((el) => el.scrollHeight > el.clientHeight * 4), {
      timeout: 15_000,
    })
    .toBe(true);
  const overflow = () => viewport.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);

  await row(page, 0).click();
  await expect(detail(page)).toBeVisible();
  await row(page, 0).click();
  await expect(detail(page)).toHaveCount(0);
  expect(await overflow()).toBeLessThanOrEqual(0);

  await row(page, 2).click();
  await viewport.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(row(page, 2)).toHaveCount(0);
  await expect(page.locator(`${grid} .slick-row[tabindex="0"]`)).toHaveCount(1);
});

test('a second chunk at the same lane count keeps the header columns', async ({ relaunch }) => {
  const page = await bootGrid(
    relaunch,
    ONE.concat([rootRow(SHA_B, 'A second, same-lane commit')]),
    { holdAfter: 1 },
  );
  const headers = page.locator(`${grid} .slick-header-column`);
  await expect(headers).toHaveCount(4);
  await headers.evaluateAll((nodes) => {
    for (const node of nodes) node.setAttribute('data-rebuild-marker', 'still-here');
  });

  await gitStreamRelease(page);
  await expect(row(page, 1)).toBeVisible();
  const marked = await headers.evaluateAll(
    (nodes) => nodes.filter((n) => n.getAttribute('data-rebuild-marker') === 'still-here').length,
  );
  expect(marked).toBe(4);
});

test('a row that grows after first paint pushes every row below it down, with no overlap', async ({
  relaunch,
}) => {
  const page = await bootGrid(relaunch, TAGGED, { holdAfter: 1 });
  await gitStreamRelease(page);
  await expect(row(page, 1)).toBeVisible();

  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="commit-grid"] .slick-row'))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return { row: Number(el.getAttribute('data-row')), top: rect.top, bottom: rect.bottom };
      })
      .sort((a, b) => a.row - b.row),
  );
  expect(rows.length).toBeGreaterThanOrEqual(2);
  for (let i = 1; i < rows.length; i++) {
    expect(rows[i].top).toBeGreaterThanOrEqual(rows[i - 1].bottom - 1);
  }
});
