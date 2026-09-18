import { expect, type Page, test } from '@playwright/test';
import {
  buildFakeGraphHostInitScript,
  FEATURE_NEWER_HIDDEN_COUNT,
  FEATURE_NEWER_SHORT_NAME,
} from './support/fakeGraphHost.ts';
import { type InteractionServer, startInteractionServer } from './support/server.ts';

/**
 * P93 §8.3: the DOM-level check for branch-grouped, collapsible layout — `rowPlan.test.ts`/
 * `rowSvg.test.ts` already cover the pure projection and node/path geometry; this is the one place
 * a real `CommitGrid.vue` mount, a real SlickGrid, and a real `AppToolbar.vue` toggle are exercised
 * together. `fakeGraphHost.ts`'s `'branchOrder'` stream mode seeds `main` (HEAD, 3 commits, never
 * collapses — group 0), `feature-newer` (5 commits, collapses by default to tip/placeholder/
 * oldest) and `feature-older` (2 commits, always full) — see that fixture's own doc comment for
 * the row/parent table. Collapsed-by-default display order (group-major, `main` first since it's
 * HEAD): `M0, M1, M2, F0, [placeholder x3], F4, G0, G1` (8 rows). Fully expanded: `M0, M1, M2, F0,
 * F1, F2, F3, F4, G0, G1` (10 rows).
 *
 * Plan-vs-implementation note: §8.3's own wording says "clicking it expands... clicking again
 * re-collapses." Tracing `GraphOrderState`/`CommitGrid.vue` end to end, no UI path re-collapses an
 * already-expanded group in a session — `toggleGroup` only ever fires from a currently-`'collapsed'`
 * placeholder row (click/Enter/Space), and the toolbar's collapse-by-default toggle never touches
 * `#expandedKeys`. This suite tests the closest real behaviour instead: a manual expand persists
 * (`'a click expands a collapsed group to its full member list'` below), and the toolbar's global
 * toggle re-collapses a *never-manually-expanded* group when turned back on (`#expandedKeys` is
 * still empty in that case) — see `'the toolbar toggle...'` below.
 */
test.describe('graph branch order and collapse', () => {
  let server: InteractionServer;

  test.beforeAll(async () => {
    server = await startInteractionServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  async function bootBranchOrder(page: Page): Promise<void> {
    await page.addInitScript(buildFakeGraphHostInitScript({ streamMode: 'branchOrder' }));
    await page.goto(`${server.url}/graph`);
    // Collapsed-by-default is the fixture's own row count floor (8 rows, row 7 the last) —
    // waiting on it is the same "wait for the real settled state" idiom `graph-columns.spec.ts`
    // uses, not an assumption about timing.
    await expect(
      page.locator('[data-testid="commit-grid"] .slick-row[data-row="7"]'),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="detail-region"]')).toHaveCount(0);
  }

  function messageCell(page: Page, row: number) {
    return page
      .locator(`[data-testid="commit-grid"] .slick-row[data-row="${row}"] .kv-cell-message`)
      .first();
  }

  function dashedPathCount(page: Page, row: number): Promise<number> {
    return page
      .locator(
        `[data-testid="commit-grid"] .slick-row[data-row="${row}"] .kv-graph-svg path[stroke-dasharray]`,
      )
      .count();
  }

  test('renders group-major: main first and never collapsed, feature-newer collapsed, feature-older in full', async ({
    page,
  }) => {
    await bootBranchOrder(page);

    await expect(messageCell(page, 0)).toContainText('main tip (M0)');
    await expect(messageCell(page, 1)).toContainText('main M1');
    await expect(messageCell(page, 2)).toContainText('main root (M2)');
    await expect(messageCell(page, 3)).toContainText('feature-newer tip (F0)');

    const placeholder = messageCell(page, 4);
    await expect(placeholder).toHaveAttribute('data-testid', 'graph-collapsed-row');
    await expect(placeholder).toContainText(
      `${FEATURE_NEWER_HIDDEN_COUNT} more commits on ${FEATURE_NEWER_SHORT_NAME}`,
    );

    await expect(messageCell(page, 5)).toContainText('feature-newer oldest (F4)');
    await expect(messageCell(page, 6)).toContainText('feature-older tip (G0)');
    await expect(messageCell(page, 7)).toContainText('feature-older oldest (G1)');
    await expect(page.locator('[data-testid="commit-grid"] .slick-row[data-row="8"]')).toHaveCount(
      0,
    );

    // Exactly one collapsed placeholder row — feature-older (2 members) never qualifies.
    await expect(page.locator('[data-testid="graph-collapsed-row"]')).toHaveCount(1);
  });

  // §6.2: the fork stub — an upward parent link, drawn as a short dashed path in the parent's lane
  // instead of feeding lane layout. Exactly two in this fixture: each feature branch's own oldest
  // commit forks off `main`.
  test("draws exactly two dashed fork stubs, on each feature branch's own oldest row", async ({
    page,
  }) => {
    await bootBranchOrder(page);

    await expect(page.locator('[data-testid="commit-grid"] path[stroke-dasharray]')).toHaveCount(2);
    expect(await dashedPathCount(page, 5)).toBe(1); // feature-newer oldest (F4) -> main M1
    expect(await dashedPathCount(page, 7)).toBe(1); // feature-older oldest (G1) -> main root M2
    for (const row of [0, 1, 2, 3, 4, 6]) {
      expect(await dashedPathCount(page, row)).toBe(0);
    }
  });

  test('a click expands a collapsed group to its full member list, in order', async ({ page }) => {
    await bootBranchOrder(page);

    await messageCell(page, 4).click();

    await expect(
      page.locator('[data-testid="commit-grid"] .slick-row[data-row="9"]'),
    ).toBeVisible();
    await expect(page.locator('[data-testid="graph-collapsed-row"]')).toHaveCount(0);

    await expect(messageCell(page, 3)).toContainText('feature-newer tip (F0)');
    await expect(messageCell(page, 4)).toContainText('feature-newer F1');
    await expect(messageCell(page, 5)).toContainText('feature-newer F2');
    await expect(messageCell(page, 6)).toContainText('feature-newer F3');
    await expect(messageCell(page, 7)).toContainText('feature-newer oldest (F4)');
    await expect(messageCell(page, 8)).toContainText('feature-older tip (G0)');
    await expect(messageCell(page, 9)).toContainText('feature-older oldest (G1)');
  });

  test('the toolbar toggle off renders every row expanded in group order; toggling back on re-collapses a never-expanded group', async ({
    page,
  }) => {
    await bootBranchOrder(page);
    const toggle = page.locator('[data-testid="graph-collapse-toggle"]');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await toggle.click();

    await expect(
      page.locator('[data-testid="commit-grid"] .slick-row[data-row="9"]'),
    ).toBeVisible();
    await expect(page.locator('[data-testid="graph-collapsed-row"]')).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await expect(messageCell(page, 0)).toContainText('main tip (M0)');
    await expect(messageCell(page, 3)).toContainText('feature-newer tip (F0)');
    await expect(messageCell(page, 4)).toContainText('feature-newer F1');
    await expect(messageCell(page, 5)).toContainText('feature-newer F2');
    await expect(messageCell(page, 6)).toContainText('feature-newer F3');
    await expect(messageCell(page, 7)).toContainText('feature-newer oldest (F4)');
    await expect(messageCell(page, 8)).toContainText('feature-older tip (G0)');
    await expect(messageCell(page, 9)).toContainText('feature-older oldest (G1)');
    // The fork stubs move with the rows they now sit on (F4 at row 7, G1 at row 9), still 2 total.
    await expect(page.locator('[data-testid="commit-grid"] path[stroke-dasharray]')).toHaveCount(2);
    expect(await dashedPathCount(page, 7)).toBe(1);
    expect(await dashedPathCount(page, 9)).toBe(1);

    await toggle.click();

    await expect(
      page.locator('[data-testid="commit-grid"] .slick-row[data-row="7"]'),
    ).toBeVisible();
    await expect(page.locator('[data-testid="commit-grid"] .slick-row[data-row="8"]')).toHaveCount(
      0,
    );
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const placeholder = messageCell(page, 4);
    await expect(placeholder).toHaveAttribute('data-testid', 'graph-collapsed-row');
    await expect(placeholder).toContainText(
      `${FEATURE_NEWER_HIDDEN_COUNT} more commits on ${FEATURE_NEWER_SHORT_NAME}`,
    );
  });

  // P92 §12.2 items 2/4's own regressions, re-checked against a row count that actually changes
  // (8 <-> 10) via a real user action, not a stream chunk landing.
  test('no row overlap and no horizontal scrollbar after toggling collapse off', async ({
    page,
  }) => {
    await bootBranchOrder(page);
    await page.locator('[data-testid="graph-collapse-toggle"]').click();
    await expect(
      page.locator('[data-testid="commit-grid"] .slick-row[data-row="9"]'),
    ).toBeVisible();

    const viewport = page.locator('[data-testid="commit-grid"] .slick-viewport').first();
    const overflow = await viewport.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    const rows = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('[data-testid="commit-grid"] .slick-row'));
      return nodes
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return { row: Number(el.getAttribute('data-row')), top: rect.top, bottom: rect.bottom };
        })
        .sort((a, b) => a.row - b.row);
    });
    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].top).toBeGreaterThan(rows[i - 1].top);
      expect(rows[i].top).toBeGreaterThanOrEqual(rows[i - 1].bottom - 1);
    }
  });
});
