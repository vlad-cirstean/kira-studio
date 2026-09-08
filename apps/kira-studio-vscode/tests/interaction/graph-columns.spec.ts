import { expect, test } from '@playwright/test';
import { buildFakeGraphHostInitScript } from './support/fakeGraphHost.ts';
import { type InteractionServer, startInteractionServer } from './support/server.ts';

/**
 * G21 D14 (item 14, §7.1/§7.2's own checklist): the grid-shape half of D5/D6 — the SHA column is
 * gone, and the date column is wide enough for its own widest absolute rendering. Both are DOM-
 * level regressions no unit test can see (`columns.ts`'s own definitions are pure data; whether
 * SlickGrid actually mounts four header columns, and how wide it actually lays the date cell out,
 * are facts about the real bundle running in a real page), so this is the interaction tier's own
 * check, over `fakeGraphHost.ts`'s one-commit fixture.
 *
 * `CommitGrid.vue` sets `showColumnHeader: false` (§6.1 — this list has no header row to show),
 * which hides the header *panel*, not the per-column header nodes SlickGrid still creates
 * unconditionally on every render — `.slick-header-column` stays a reliable, real, four-per-grid
 * count regardless.
 */
test.describe('graph grid columns', () => {
  let server: InteractionServer;

  test.beforeAll(async () => {
    server = await startInteractionServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  async function bootGraph(page: import('@playwright/test').Page): Promise<void> {
    await page.addInitScript(buildFakeGraphHostInitScript());
    await page.goto(`${server.url}/graph`);
    await expect(
      page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"]'),
    ).toBeVisible();
  }

  // D5: the SHA column (and its own copy-on-click button) is deleted outright, not merely hidden
  // — CommitMeta.vue's own single SHA row (G21 D5) is the one place a full sha is shown/copied now.
  test('renders exactly the four remaining columns, with no SHA cell anywhere', async ({
    page,
  }) => {
    await bootGraph(page);

    const headers = page.locator('[data-testid="commit-grid"] .slick-header-column');
    await expect(headers).toHaveCount(4);
    const ids = await headers.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-id')));
    expect(new Set(ids)).toEqual(new Set(['graph', 'message', 'author', 'date']));

    await expect(page.locator('.kv-cell-sha')).toHaveCount(0);
  });

  // D6b: the date column's own floor is measured against `dateFormat.ts`'s widest absolute
  // rendering at the *live* `.kv-cell-date` font, not a hard-coded pixel value that only happens
  // to be right at one font size (F6). The width asserted on is the real `.slick-cell`'s own
  // fixed-width box (the column's actual layout constraint) — `.kv-cell-date` itself is a plain
  // inline `<span>` inside it, which would only ever report its own shrink-to-fit text width.
  test('the date column is at least as wide as its own widest absolute rendering', async ({
    page,
  }) => {
    await bootGraph(page);

    const dateLabel = page
      .locator('[data-testid="commit-grid"] .slick-row[data-row="0"] .kv-cell-date')
      .first();
    await expect(dateLabel).toBeVisible();

    const { cellWidth, measuredWidth } = await dateLabel.evaluate((span) => {
      const cell = span.closest('.slick-cell');
      if (!cell) throw new Error('.kv-cell-date has no ancestor .slick-cell');
      const rect = cell.getBoundingClientRect();
      const style = getComputedStyle(span);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2d canvas context unavailable in this browser');
      ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}/${style.lineHeight} ${style.fontFamily}`;
      // `dateFormat.ts`'s own `formatAbsoluteDate(WIDEST_SAMPLE_TIMESTAMP)` — see
      // `fakeGraphHost.ts`'s doc comment for why this is a literal here, not an import.
      const measured = ctx.measureText('2024-12-30 22:48').width;
      return { cellWidth: rect.width, measuredWidth: measured };
    });

    expect(cellWidth).toBeGreaterThanOrEqual(measuredWidth);
  });

  test('the one loaded row is the fixture commit', async ({ page }) => {
    await bootGraph(page);
    await expect(
      page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"] .kv-cell-message'),
    ).toContainText('Add the graph column fixture');
  });
});
