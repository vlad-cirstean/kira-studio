import { expect, type Page, test } from '@playwright/test';
import { buildFakeGraphHostInitScript } from './support/fakeGraphHost.ts';
import { type InteractionServer, startInteractionServer } from './support/server.ts';

/**
 * P108 F1 regression: `CommitGrid.vue`'s `initialScrollRow` prop (`viewState.scrollRow`,
 * restored by `App.vue`'s cold-bootstrap `persisted.repoId` branch) used to convert the
 * persisted store row through `plan().displayRowOf(...)` unguarded — `RowPlan.displayRowOf`
 * asserted the row was in range and threw `AssertionError` in production.
 *
 * Reachable two ways, both covered here:
 * - Cold boot: `CommitGrid.vue` mounts (and runs its own `onMounted`) before the first
 *   `graph.stream` chunk has landed, so `plan()` is still `identityRowPlan(0)` — a persisted
 *   `scrollRow: 0` asserted "out of range" against a plan that covers zero rows, even though the
 *   row was perfectly valid once the first chunk actually arrived a moment later.
 * - A genuinely out-of-range row (a persisted scroll position from a repo/session that has since
 *   shrunk) — the fix (`rowPlan.ts`'s own `displayRowOf`/`storeLength`, `CommitGrid.vue`'s
 *   `applyInitialScrollRow`) clamps to the nearest row that still exists instead of crashing.
 *
 * Both cases render through `buildFakeGraphHostInitScript`'s `persistedScrollRow` option, which
 * seeds `acquireVsCodeApi().getState()` with a full, current-shape `PersistedViewState` — the one
 * `App.vue`'s `bootstrap()` actually reads back via `viewState.read()`.
 */
test.describe('CommitGrid initial scroll row (P108 F1)', () => {
  let server: InteractionServer;

  test.beforeAll(async () => {
    server = await startInteractionServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  function trackErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    return errors;
  }

  test('a persisted scrollRow: 0 does not crash on a cold boot that mounts before the first chunk lands', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    // The default 'oneChunk' stream (one row) — the exact shape the review's own probe used:
    // even the smallest, perfectly in-range persisted row (0) reproduced the assert, since the
    // grid mounts against `identityRowPlan(0)` before that one chunk has actually landed.
    await page.addInitScript(buildFakeGraphHostInitScript({ persistedScrollRow: 0 }));
    await page.goto(`${server.url}/graph`);

    await expect(
      page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"]'),
    ).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('a persisted scrollRow beyond the current history clamps to the last row instead of crashing', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    // 300 rows load (0..299); a persisted scrollRow far beyond that (a session from a much larger
    // history, or one that has since shrunk) has no display row of its own once loading settles —
    // `applyInitialScrollRow` clamps it to row 299 rather than leaving `initialScrollRow` unapplied
    // forever or asserting.
    await page.addInitScript(
      buildFakeGraphHostInitScript({ streamMode: 'manyRows', persistedScrollRow: 999_999 }),
    );
    await page.goto(`${server.url}/graph`);

    // Not row 0: a successful clamp scrolls straight to the last row, so row 0 is virtualized
    // out of the DOM the moment the grid settles — any rendered row is the real "grid mounted"
    // signal here.
    await expect(page.locator('[data-testid="commit-grid"] .slick-row').first()).toBeVisible();

    const viewport = page.locator('[data-testid="commit-grid"] .slick-viewport').first();
    // Same "settles asynchronously off the layout worker" wait `graph-columns.spec.ts`'s own
    // viewport-sizing case uses — a real scrollbar is this fixture's whole point.
    await expect
      .poll(() => viewport.evaluate((el) => el.scrollHeight > el.clientHeight), { timeout: 5000 })
      .toBe(true);
    // Clamped to the last real row (`MANY_ROWS_COUNT - 1`) — scrolled meaningfully down, not left
    // stuck at the top the way a silently-skipped `scrollRowIntoView` call would leave it.
    await expect
      .poll(() => viewport.evaluate((el) => el.scrollTop), { timeout: 5000 })
      .toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });
});
