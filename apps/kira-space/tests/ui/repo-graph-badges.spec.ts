import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  chunkedRows,
  manyRowShas,
  openPortGraph,
  PORT_CONTROL,
  type Relaunch,
  realisticRows,
  refsAtTip,
} from './support/gitUiPortFixtures';

// Badge-line geometry on a realistic history: long ref names, a row with six refs, a narrow
// message cell. P258 clipped the strip mid-badge and hid the +N chip; these must stay whole.

const grid = '[data-testid="commit-grid"]';
const row = (p: Page, n: number) => p.locator(`${grid} .slick-row[data-row="${n}"]`);
const message = (p: Page, n: number) => row(p, n).locator('.kira-cell-message');
const detail = (p: Page) => p.locator('[data-testid="detail-region"]');

const SIX_REF_ROW = 0;
const TWO_REF_ROW = 12;
const PLAIN_ROW = 1;

async function bootRealistic(relaunch: Relaunch): Promise<Page> {
  const page = await openPortGraph(relaunch, {
    control: PORT_CONTROL,
    chunks: chunkedRows(realisticRows(60), 60),
    results: { 'refs.list': refsAtTip(manyRowShas(0)) },
  });
  await page.setViewportSize({ width: 1280, height: 760 });
  await expect(row(page, TWO_REF_ROW)).toBeVisible();
  return page;
}

async function setDetailOpen(page: Page, open: boolean): Promise<void> {
  const isOpen = (await detail(page).count()) > 0;
  if (isOpen === open) return;
  await expect(async () => {
    if (open) await row(page, PLAIN_ROW).click();
    else await page.keyboard.press('Escape');
    await expect(detail(page)).toHaveCount(open ? 1 : 0, { timeout: 1000 });
  }).toPass();
  await expect(row(page, TWO_REF_ROW)).toBeVisible();
}

const rect = (l: Locator) => l.evaluate((el) => el.getBoundingClientRect().toJSON());

async function expectBadgeLineGeometry(page: Page): Promise<void> {
  const plain = await rect(row(page, PLAIN_ROW));
  for (const n of [SIX_REF_ROW, TWO_REF_ROW]) {
    const decorated = await rect(row(page, n));
    const strip = await rect(message(page, n).locator('> span').first());
    const subject = await rect(message(page, n).locator('[data-testid="message-subject"]'));
    const badge = await rect(message(page, n).locator('[data-kira-tip]').first());
    expect(strip.bottom).toBeLessThanOrEqual(subject.top + 0.5);
    expect(Math.abs(decorated.height - (plain.height + badge.height))).toBeLessThanOrEqual(1);

    const { cy, rowTop } = await row(page, n).evaluate((el) => ({
      cy: Number(el.querySelector('[data-testid="graph-svg"] circle')?.getAttribute('cy')),
      rowTop: el.getBoundingClientRect().top,
    }));
    expect(Math.abs(rowTop + cy - (subject.top + subject.height / 2))).toBeLessThanOrEqual(2);
  }

  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="commit-grid"] .slick-row'))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { row: Number(el.getAttribute('data-row')), top: r.top, bottom: r.bottom };
      })
      .sort((a, b) => a.row - b.row),
  );
  for (let i = 1; i < rows.length; i++) {
    expect(Math.abs(rows[i].top - rows[i - 1].bottom)).toBeLessThanOrEqual(1);
  }
}

/** Every badge lies inside the message cell with its box unclipped; only a label may ellipsize. */
async function expectBadgesWhole(page: Page): Promise<void> {
  for (const n of [SIX_REF_ROW, TWO_REF_ROW]) {
    const cell = await rect(message(page, n));
    const badges = message(page, n).locator('[data-kira-tip]');
    const count = await badges.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const info = await badges.nth(i).evaluate((el) => {
        const box = el.getBoundingClientRect();
        const label = el.querySelector(
          ':scope > span:not([data-testid="badge-icon"]):not(.codicon)',
        );
        return {
          left: box.left,
          right: box.right,
          boxClipped: el.scrollWidth > el.clientWidth + 1,
          // The +N chip is bare text: its own box is the label.
          labelWidth: (label ?? el).getBoundingClientRect().width,
          tip: el.getAttribute('data-kira-tip') ?? '',
        };
      });
      expect(info.left).toBeGreaterThanOrEqual(cell.left - 0.5);
      expect(info.right).toBeLessThanOrEqual(cell.right + 0.5);
      expect(info.boxClipped, info.tip).toBe(false);
      expect(info.labelWidth, info.tip).toBeGreaterThan(8);
    }
  }
}

async function expectPlusChip(page: Page): Promise<void> {
  const badges = message(page, SIX_REF_ROW).locator('[data-kira-tip]');
  await expect(badges).toHaveCount(4);
  const chip = badges.last();
  await expect(chip).toHaveText('+3');
  await expect(chip).toBeVisible();
  const tip = (await chip.getAttribute('data-kira-tip')) ?? '';
  for (const name of [
    'main',
    'origin/main',
    'feature/graph-badge-clipping-regression-investigation',
    'origin/feature/graph-badge-clipping-regression-investigation',
    'v2.0.0-rc.1',
    'feature/very-long-branch-name-for-the-second-lane',
  ]) {
    expect(tip).toContain(name);
  }
}

for (const detailOpen of [true, false]) {
  test(`badge line, whole badges and +N chip hold with the detail pane ${detailOpen ? 'open' : 'closed'}`, async ({
    relaunch,
  }) => {
    const page = await bootRealistic(relaunch);
    await setDetailOpen(page, detailOpen);
    await expectBadgeLineGeometry(page);
    await expectBadgesWhole(page);
    await expectPlusChip(page);
  });
}

test('dragging the author column wide leaves the badges whole and the +N chip visible', async ({
  relaunch,
}) => {
  const page = await bootRealistic(relaunch);
  await setDetailOpen(page, false);

  const handle = page.getByRole('separator', { name: 'Resize author column' });
  const box = await handle.boundingBox();
  if (!box) throw new Error('author resize handle has no box');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x - 200, y, { steps: 8 });
  await page.mouse.up();

  const narrow = await rect(message(page, SIX_REF_ROW));
  expect(narrow.width).toBeLessThan(500);
  await expectBadgeLineGeometry(page);
  await expectBadgesWhole(page);
  await expectPlusChip(page);
});
