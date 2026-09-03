import { DATA_OP } from '@shared/protocol/data-ops';
import type { ColumnDescriptor } from '@shared/protocol/page';
import type { ControlSnapshot, PortSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import {
  APP_CHILDREN,
  APP_PATH,
  BIG_ROWS_PATH,
  bigRowsFixture,
  bigRowsHugePage,
  connectAndExpandControl,
  DB_PATH,
  postgresConnectionSummary,
} from './support/postgresFixture';
import { expandRow, findRow, openRowMenu } from './support/tree';

// P22 spike, C6 — §7.4(a)'s eight sandbox-provable exit criteria, gated against a build with
// window.__kiraGridEngine forced to 'slick' before boot. This does NOT re-gate the existing
// budgets/perf suite (those keep running against the default 'tanstack' engine, unmodified — §7.1)
// and does NOT and cannot answer §7.4(b) — the real-Mac perceptual/latency verdict, which needs a
// live compositor this environment has no way to produce (see docs/PERF.md's own §2.1c/§7.4(b)
// pointer). What this file proves is narrower and mechanical: the bridge decodes real data
// correctly, the runway matches or exceeds the incumbent's, the DOM stays bounded, a sub-row scroll
// touches nothing, and — the single item the brief singled out — closing the tab actually tears the
// grid down.
//
// The fixture: a synthetic 61-column, 1000-row table ("spike_grid") — wide (like scroll_grid,
// budgets.spec.ts) AND tall (unlike scroll_grid's own 100-row mock, which never scrolls), and
// carrying at least one column from each type category `theme/icons.ts`'s categoryForTypeClass can
// return (numeric/boolean/datetime/string) so the column-level type-colour class (§6 D6) has real
// material to colour. One page, `hasMore: false` — no pagination cursor to simulate.

const CONNECTION_ID = 'conn-slick-spike';
const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Slick Spike DB', 'magenta');
const SPIKE_GRID_PATH = `${APP_PATH}/table:spike_grid`;
const ROW_COUNT = 1000;
const TEXT_COLUMNS = 57; // + id + active + created_at = 60 data columns, 61 with the gutter.

function spikeGridColumns(): ColumnDescriptor[] {
  const cols: ColumnDescriptor[] = [
    {
      name: 'id',
      dataType: 'integer',
      typeClass: 'number',
      nullable: false,
      isPrimaryKey: true,
      generated: false,
    },
    {
      name: 'active',
      dataType: 'boolean',
      typeClass: 'boolean',
      nullable: false,
      isPrimaryKey: false,
      generated: false,
    },
    {
      name: 'created_at',
      dataType: 'timestamp',
      typeClass: 'temporal',
      nullable: false,
      isPrimaryKey: false,
      generated: false,
    },
  ];
  for (let j = 1; j <= TEXT_COLUMNS; j++) {
    cols.push({
      name: `col${j}`,
      dataType: 'text',
      typeClass: 'text',
      nullable: false,
      isPrimaryKey: false,
      generated: false,
    });
  }
  return cols;
}

function spikeGridRow(i: number): (string | null)[] {
  const row: (string | null)[] = [
    String(i),
    i % 2 === 0 ? 'true' : 'false',
    '2024-01-15T10:23:45Z',
  ];
  for (let j = 1; j <= TEXT_COLUMNS; j++) row.push(`row ${i} col ${j}`);
  return row;
}

function spikeGridRows(count: number): (string | null)[][] {
  return Array.from({ length: count }, (_, i) => spikeGridRow(i));
}

function spikeGridMeta() {
  const columns = [
    {
      name: 'id',
      position: 1,
      dataType: 'integer',
      nullable: false,
      defaultExpr: null,
      isPrimaryKey: true,
      comment: null,
    },
    {
      name: 'active',
      position: 2,
      dataType: 'boolean',
      nullable: false,
      defaultExpr: null,
      isPrimaryKey: false,
      comment: null,
    },
    {
      name: 'created_at',
      position: 3,
      dataType: 'timestamp',
      nullable: false,
      defaultExpr: null,
      isPrimaryKey: false,
      comment: null,
    },
  ];
  for (let j = 1; j <= TEXT_COLUMNS; j++) {
    columns.push({
      name: `col${j}`,
      position: j + 3,
      dataType: 'text',
      nullable: false,
      defaultExpr: null,
      isPrimaryKey: false,
      comment: null,
    });
  }
  return {
    path: SPIKE_GRID_PATH,
    kind: 'table' as const,
    name: 'spike_grid',
    qualifiedName: 'app.spike_grid',
    columns,
    primaryKey: ['id'],
    foreignKeys: [],
    referencedBy: [],
    indexes: [
      { name: 'spike_grid_pkey', columns: ['id'], unique: true, primary: true, method: 'btree' },
    ],
    rowEstimate: ROW_COUNT,
    comment: null,
  };
}

const APP_CHILDREN_WITH_SPIKE_GRID = [
  ...APP_CHILDREN,
  {
    kind: 'table',
    name: 'spike_grid',
    path: SPIKE_GRID_PATH,
    hasChildren: false,
    detail: `~${ROW_COUNT} rows`,
  },
];

function readSnapshot(pageSize: number): PortSnapshot {
  return {
    op: DATA_OP.read,
    payload: {
      connectionId: CONNECTION_ID,
      path: SPIKE_GRID_PATH,
      projection: null,
      filter: null,
      sort: null,
      pageSize,
      cursor: { mode: 'offset', offset: 0 },
    },
    response: {
      kind: 'read',
      page: {
        kind: 'tabular',
        columns: spikeGridColumns(),
        rows: spikeGridRows(pageSize),
        position: {
          offset: 0,
          pageSize,
          hasMore: false,
          nextToken: null,
          prevToken: null,
          strategy: 'keyset',
        },
        truncatedCells: 0,
      },
      source: 'server',
    },
  };
}

const CONTROL: ControlSnapshot[] = [
  { channel: IPC.connectionsList, response: [] },
  {
    channel: IPC.connectionsCreate,
    args: {
      name: 'Slick Spike DB',
      kind: 'postgres',
      color: 'magenta',
      mode: 'fields',
      readOnly: false,
      host: '127.0.0.1',
      port: 5432,
      database: 'kira_test',
      username: 'postgres',
      password: null,
      uri: null,
      options: {},
      preconnect: null,
      preconnectSidecar: false,
      autoExplain: false,
    },
    response: CONNECTION_SUMMARY,
  },
  ...connectAndExpandControl(CONNECTION_ID).map((snap) =>
    snap.channel === IPC.treeChildren && (snap.args as { path?: string })?.path === APP_PATH
      ? {
          ...snap,
          response: { nodes: APP_CHILDREN_WITH_SPIKE_GRID, source: 'server', truncated: false },
        }
      : snap,
  ),
  {
    channel: IPC.treeDescribe,
    args: { connectionId: CONNECTION_ID, path: SPIKE_GRID_PATH, refresh: false, tabId: null },
    response: { meta: spikeGridMeta(), source: 'server' },
  },
];

const PORT: PortSnapshot[] = [readSnapshot(100), readSnapshot(1000)];

/** page.addInitScript + reload — the same pattern interaction.spec.ts's own installClipboardShim
 *  uses for a hazard that must be in place *before* the app's first script runs, not merely before
 *  it's used: relaunch()'s own navigation already happened by the time this spec gets the page. */
async function forceSlickEngine(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __kiraGridEngine?: string }).__kiraGridEngine = 'slick';
  });
  await page.reload();
  await page.waitForSelector('[data-testid="status-bar"]');
}

/** The connect/expand/open flow shared by both engines — `readySelector` is the one thing that
 *  differs: SlickGridHost.vue's own `.slick-cell`/`.slick-viewport-top.slick-viewport-right` vs.
 *  DataGrid.vue's own `[data-testid="grid-cell"]`. */
async function connectAndOpenSpikeGrid(
  page: import('@playwright/test').Page,
  readySelector = '[data-testid="data-grid"] .slick-cell',
): Promise<void> {
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', 'Slick Spike DB');
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '5432');
  await page.fill('[data-testid="connection-database"]', 'kira_test');
  await page.fill('[data-testid="connection-username"]', 'postgres');
  await page.click('[data-testid="color-magenta"]');
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  const connRow = page.locator('[data-testid="tree-row"][data-kind="connection"]');
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });
  await expandRow(page, '');
  await expandRow(page, DB_PATH);
  await expandRow(page, APP_PATH);

  const row = await findRow(page, SPIKE_GRID_PATH);
  await row.dblclick();
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  await page.click('[data-testid="page-size-1000"]');
  await expect
    .poll(async () => page.locator(readySelector).count(), { timeout: 15_000 })
    .toBeGreaterThan(0);
}

/** Reopens the already-connected, already-navigated-to spike_grid table in a fresh tab — the
 *  teardown loop's own repeat-open path, sharing the tree/connection state `connectAndOpenSpikeGrid`
 *  already set up rather than reconnecting from scratch each cycle. */
async function reopenSpikeGridTab(page: import('@playwright/test').Page): Promise<void> {
  await openRowMenu(page, SPIKE_GRID_PATH);
  await page.click('[data-testid="menu-item-open-data-new-tab"]');
  await expect
    .poll(async () => page.locator('[data-testid="data-grid"] .slick-cell').count(), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
}

function rightViewport(page: import('@playwright/test').Page) {
  return page.locator('[data-testid="data-grid"] .slick-viewport-top.slick-viewport-right');
}

// Counts only SlickGrid's OWN per-instance <style> element (F8's own createCssRules/
// removeCssRules), not every <style> tag in <head> — opening a data tab also mounts
// FilterToolbar.vue's CodeMirror-based WHERE/ORDER BY fields, and CodeMirror 6's own StyleModule
// injects one *global*, content-hash-deduplicated <style> the first time any editor uses it, by
// design never removed (confirmed empirically: its rules are `.ͼ1.cm-focused {...}`, nothing to do
// with this grid). SlickGrid's own rules are always scoped `.<uid> .slick-header-column { ... }`
// (createCssRules, dist/esm/index.mjs read this session) — a real signature the CodeMirror one can
// never share. Module-scope (not nested in the exit-criteria test below) so P22 iter2-pacing's own
// teardown test (T4) can reuse it without restating it.
async function slickStyleTagCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(
    () =>
      Array.from(document.querySelectorAll('style')).filter((s) => {
        try {
          return Array.from(s.sheet?.cssRules ?? []).some(
            (r) =>
              'selectorText' in r &&
              (r as CSSStyleRule).selectorText?.includes('slick-header-column'),
          );
        } catch {
          return false;
        }
      }).length,
  );
}

// P22 iter2-pacing §1.2/§3 F2 — the doubling this phase's T1/T3 gate only reproduces under a
// page.mouse.wheel-driven scroll, never a `scrollTop +=` write: the two input paths give
// *different* intra-frame orderings between the scroll-driven render and a same-frame chase. No
// artificial delay between wheel calls — a real fling delivers scroll events far faster than
// CHASE_QUIET_MS (24ms), which is exactly the condition the pacing fix's re-arm loop is for.
async function wheelFling(
  page: import('@playwright/test').Page,
  viewport: ReturnType<typeof rightViewport>,
  steps = 60,
  deltaY = 900,
): Promise<void> {
  const box = await viewport.boundingBox();
  if (!box) throw new Error('wheelFling: viewport has no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, deltaY);
  }
}

test("SlickGrid spike — §7.4(a)'s eight sandbox-provable exit criteria", async ({
  relaunch,
  consoleErrors,
}) => {
  // Three full connect/expand/navigate cycles (this run, the tanstack A/B comparison, the teardown
  // loop's own initial open) plus 5 bare reopen cycles — comfortably past Playwright's 30s default.
  test.setTimeout(300_000);
  const { window: page } = await relaunch({ control: CONTROL, stream: PORT });
  await forceSlickEngine(page);
  await connectAndOpenSpikeGrid(page);

  // --- 1. correct decoded text, cell for cell, across the first mounted window ------------------
  // Selected by position (`.nth()`), not by a column-name class — SlickGrid's own per-cell class is
  // `column.cssClass` (the tc-<category> type-colour class, D6), never the column's name/field; a
  // testid-free spike (D10 explicitly deferred to Pass B, §5.1 item 4) has no other stable per-
  // column hook. Column order in the right (unfrozen) pane: id(0), active(1), created_at(2),
  // col1(3), col2(4), … — the gutter (frozen, index 0 overall) lives in the left pane only.
  await rightViewport(page).evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForTimeout(50);
  function dataRow(p: import('@playwright/test').Page, row: number) {
    return p.locator(
      `[data-testid="data-grid"] .grid-canvas-top.grid-canvas-right .slick-row[data-row="${row}"] .slick-cell`,
    );
  }
  await expect(dataRow(page, 0).nth(3)).toHaveText('row 0 col 1');
  await expect(dataRow(page, 0).nth(7)).toHaveText('row 0 col 5');
  await expect(dataRow(page, 3).nth(12)).toHaveText('row 3 col 10');
  // The frozen gutter shows the page-global row number (rowNumberBase + row + 1), unfiltered here
  // so display position === page row (§5 item 5) — the gutter is the left pane's own one cell.
  await expect(
    page.locator(
      '[data-testid="data-grid"] .grid-canvas-top.grid-canvas-left .slick-row[data-row="0"] .slick-cell',
    ),
  ).toHaveText('1');

  // Type-based cell colour (§6 D6): the numeric/boolean/datetime columns each carry their own
  // tc-<category> class on every one of their own cells, AND (the P9 rowColoring setting defaults
  // on) actually resolve to a distinct computed colour — asserting the class alone would pass even
  // if the .kira-grid--row-coloring gating class were never applied to the host root.
  await expect(dataRow(page, 0).nth(0)).toHaveClass(/tc-numeric/);
  await expect(dataRow(page, 0).nth(1)).toHaveClass(/tc-boolean/);
  await expect(dataRow(page, 0).nth(2)).toHaveClass(/tc-datetime/);
  await expect(dataRow(page, 0).nth(3)).not.toHaveClass(/tc-numeric|tc-boolean|tc-datetime/);
  const [numericColor, boolColor, dateColor, textColor] = await Promise.all(
    [0, 1, 2, 3].map((i) =>
      dataRow(page, 0)
        .nth(i)
        .evaluate((el) => getComputedStyle(el).color),
    ),
  );
  expect(numericColor).not.toBe(textColor);
  expect(boolColor).not.toBe(textColor);
  expect(dateColor).not.toBe(textColor);
  expect(new Set([numericColor, boolColor, dateColor]).size).toBe(3);

  // --- 2. decode-cache pinning under a sustained scroll (P5 C1) — the single highest-risk item ---
  async function decodeCacheRows(): Promise<number> {
    return page.evaluate(
      () =>
        (
          window as unknown as {
            __kiraRetention: () => { stores: { grid: { decodeCacheRows: number } } };
          }
        ).__kiraRetention().stores.grid.decodeCacheRows,
    );
  }
  const atRestRows = await decodeCacheRows();
  expect(atRestRows).toBeGreaterThan(0);
  expect(atRestRows).toBeLessThan(200); // well under ROW_COUNT — nowhere near "decoded everything"

  for (let i = 0; i < 15; i++) {
    await rightViewport(page).evaluate((el) => {
      el.scrollTop += 400;
    });
    await page.waitForTimeout(30);
  }
  const afterScrollRows = await decodeCacheRows();
  // "Pinned to the mounted window" — bounded, not accumulating toward ROW_COUNT as more of the
  // table is visited over the course of the fling.
  expect(afterScrollRows).toBeLessThan(200);

  // --- 3. sub-row scroll -> zero DOM mutations; a scroll past the whole runway -> some -----------
  await rightViewport(page).evaluate((el) => {
    el.scrollTop = 5000; // an ordinary mid-scroll position, away from either end
  });
  await page.waitForTimeout(300);
  const subRowMutations = await rightViewport(page).evaluate(async (el) => {
    let count = 0;
    const observer = new MutationObserver((records) => {
      count += records.length;
    });
    observer.observe(el, { childList: true, subtree: true, attributes: true });
    el.scrollTop += 4; // well under a 28px row
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    observer.disconnect();
    return count;
  });
  expect(subRowMutations).toBe(0);

  const crossRowMutations = await rightViewport(page).evaluate(async (el) => {
    let count = 0;
    const observer = new MutationObserver((records) => {
      count += records.length;
    });
    observer.observe(el, { childList: true, subtree: true, attributes: true });
    el.scrollTop += 3000; // far past the whole runway on either side
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    observer.disconnect();
    return count;
  });
  expect(crossRowMutations).toBeGreaterThan(0);

  // --- 3a. the render batch converges over frames, not in one jump (P22 iter2-scroll-gaps D4) -----
  // A jump well past the whole runway, landing in never-before-mounted territory (the very bottom of
  // the table — nothing above has scrolled anywhere near it). D2's own per-call new-cell budget means
  // the mounted .slick-cell count measured on the *very next* animation frame is smaller than the
  // count measured several more frames later — the window visibly *converges* toward its full target
  // over a handful of self-scheduled catch-up renders, rather than jumping to full size in one call.
  const convergence = await rightViewport(page).evaluate(async (el) => {
    el.scrollTop = el.scrollHeight;
    const counts: number[] = [];
    for (let i = 0; i < 10; i++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      counts.push(document.querySelectorAll('[data-testid="data-grid"] .slick-cell').length);
    }
    return counts;
  });
  // The strictly-visible floor is never itself deferred (D2 step 1) — some cells mount immediately.
  expect(convergence[0]).toBeGreaterThan(0);
  // ...but the batch cap defers the rest of the runway, so the window is still growing several
  // frames later — a single-jump render would make these equal.
  expect(convergence[0]).toBeLessThan(convergence[convergence.length - 1]);

  // --- 4. mounted .slick-cell count stays under 2 500 across a velocity ladder -------------------
  // scroll_grid_data's own 60 data columns behave like budgets.spec.ts's own scroll_grid — this is
  // the wide-table case the cell-budget cap (D4's third bullet) exists for.
  for (const pxPerFrame of [40, 100, 200, 456]) {
    await rightViewport(page).evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(50);
    for (let frame = 0; frame < 20; frame++) {
      await rightViewport(page).evaluate((el, delta) => {
        el.scrollTop += delta;
      }, pxPerFrame);
      await page.waitForTimeout(16);
    }
    const cellCount = await page.locator('[data-testid="data-grid"] .slick-cell').count();
    expect(cellCount).toBeLessThan(2500);
  }
  await rightViewport(page).evaluate((el) => {
    el.scrollTop = 0;
  });

  // --- 5. at rest, the mounted row band covers at least as much as the incumbent's does ----------
  await page.waitForTimeout(100);
  const slickBand = await page.evaluate(() => {
    const els = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="data-grid"] .grid-canvas-top.grid-canvas-right .slick-row',
      ),
    );
    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const el of els) {
      if (el.offsetTop < top) top = el.offsetTop;
      const end = el.offsetTop + el.offsetHeight;
      if (end > bottom) bottom = end;
    }
    return { top, bottom, rows: els.length };
  });
  expect(slickBand.rows).toBeGreaterThan(0);
  const slickCoveragePx = slickBand.bottom - slickBand.top;

  // The incumbent's own at-rest coverage, same fixture, same window, measured in a fresh page —
  // `relaunch()` closes the Slick page above, which is fine: `slickCoveragePx` is already captured.
  // Item 6 below calls `relaunch()` again for its own fresh, unrelated page.
  const tanstack = await relaunch({ control: CONTROL, stream: PORT });
  await connectAndOpenSpikeGrid(tanstack.window, '[data-testid="grid-cell"]');
  await tanstack.window.locator('[data-testid="data-grid"]').evaluate((el) => {
    el.scrollTop = 0;
  });
  await tanstack.window.waitForTimeout(100);
  const tanstackBand = await tanstack.window.evaluate(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="grid-row"]'));
    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const el of els) {
      if (el.offsetTop < top) top = el.offsetTop;
      const end = el.offsetTop + el.offsetHeight;
      if (end > bottom) bottom = end;
    }
    return { top, bottom, rows: els.length };
  });
  expect(tanstackBand.rows).toBeGreaterThan(0);
  const tanstackCoveragePx = tanstackBand.bottom - tanstackBand.top;
  expect(slickCoveragePx).toBeGreaterThanOrEqual(tanstackCoveragePx);

  // --- 6. tab-close teardown (D3's own three-part assertion) — the one item this brief singled out
  const { window: teardownPage } = await relaunch({ control: CONTROL, stream: PORT });
  await forceSlickEngine(teardownPage);

  const baselineStyles = await slickStyleTagCount(teardownPage);
  const baselineRetention = await teardownPage.evaluate(() =>
    JSON.stringify((window as unknown as { __kiraRetention: () => unknown }).__kiraRetention()),
  );
  const baselineBytes = await teardownPage.evaluate(() =>
    (window as unknown as { __kiraRetainedBytes: () => number }).__kiraRetainedBytes(),
  );

  await connectAndOpenSpikeGrid(teardownPage);
  for (let i = 0; i < 5; i++) {
    if (i > 0) await reopenSpikeGridTab(teardownPage);
    await teardownPage.locator('[data-testid="tab"].is-active [data-testid="tab-close"]').click();
    await expect(teardownPage.locator('[data-testid="tab"]')).toHaveCount(0);
  }

  await expect(teardownPage.locator('.slick-viewport')).toHaveCount(0);
  const closedStyles = await slickStyleTagCount(teardownPage);
  expect(closedStyles).toBe(baselineStyles);
  const closedRetention = await teardownPage.evaluate(() =>
    JSON.stringify((window as unknown as { __kiraRetention: () => unknown }).__kiraRetention()),
  );
  expect(closedRetention).toBe(baselineRetention);
  const closedBytes = await teardownPage.evaluate(() =>
    (window as unknown as { __kiraRetainedBytes: () => number }).__kiraRetainedBytes(),
  );
  expect(closedBytes).toBe(baselineBytes);

  expect(consoleErrors).toEqual([]);
});

// P22 iter2-pacing §6 — the frame-pacing fix's own sandbox-provable gates (T1/T3/T5). D1's whole
// premise is a real WebKit measurement (§1.2 of that plan: two render() passes in 131 of 140
// frames of a wheel-driven fling, reproduced with the exact pre-fix policy) — see wheelFling's own
// comment for why page.mouse.wheel, not a scrollTop write, is load-bearing here.
test('P22 iter2-pacing — a catch-up render never shares a frame with a scroll-driven one', async ({
  relaunch,
}) => {
  test.setTimeout(120_000);
  const { window: page } = await relaunch({ control: CONTROL, stream: PORT });
  await forceSlickEngine(page);
  await connectAndOpenSpikeGrid(page);
  const viewport = rightViewport(page);

  // --- T1: at rest, the default policy never doubles a frame ------------------------------------
  // This gates the *policy* — never render twice in a frame while scroll events are arriving —
  // which is engine-independent; it is not a timing claim about WKWebView, which this sandbox has
  // none of (§7.1's own line between what's provable here and what needs real hardware).
  await viewport.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForTimeout(50);
  await page.evaluate(() => window.__kiraScrollTrace?.start());
  await wheelFling(page, viewport);
  // Trailing quiescent frames, so any chase still converging the runway gets to run and clear.
  await page.waitForTimeout(300);
  const defaultResult = await page.evaluate(() => window.__kiraScrollTrace?.stop());
  expect(defaultResult).not.toBeNull();
  const defaultHistogram = defaultResult?.summary.renderCountHistogram ?? {};
  for (const count of Object.keys(defaultHistogram)) {
    expect(Number(count)).toBeLessThan(2);
  }

  // --- T5: the trace's per-frame accounting resets (D3) ------------------------------------------
  // From frames[] directly, on this same recording: a frame with renderCount === 0 must report
  // renderMs === 0 (before D3, it reported the *previous* frame's value), a multi-render frame's
  // renderMs must be positive (it's a sum, not the sticky last value), and frameMs must show up
  // once ticks are actually spaced (not every frame is guaranteed non-zero — a genuine same-
  // timestamp double rAF tick is possible — so this checks the series as a whole, not one frame).
  const frames = defaultResult?.frames ?? [];
  const noRenderFrame = frames.find((f) => f.renderCount === 0);
  expect(noRenderFrame).toBeDefined();
  expect(noRenderFrame?.renderMs).toBe(0);
  for (const f of frames) {
    if (f.renderCount > 1) expect(f.renderMs).toBeGreaterThan(0);
  }
  expect(frames.some((f) => f.frameMs > 0)).toBe(true);

  // --- T3: chaseQuietMsOverride = 0 reproduces the pre-fix behaviour exactly ---------------------
  // The self-verifying half of T1: if this run does NOT show a doubled frame, the harness is not
  // reproducing the doubling condition at all and T1 above would be a tautology, not a real gate.
  await viewport.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForTimeout(50);
  await page.evaluate(() => {
    window.__kiraGridTuning ??= {};
    window.__kiraGridTuning.chaseQuietMsOverride = 0;
  });
  await page.evaluate(() => window.__kiraScrollTrace?.start());
  await wheelFling(page, viewport);
  await page.waitForTimeout(300);
  const zeroResult = await page.evaluate(() => window.__kiraScrollTrace?.stop());
  await page.evaluate(() => {
    if (window.__kiraGridTuning) window.__kiraGridTuning.chaseQuietMsOverride = undefined;
  });
  expect(zeroResult).not.toBeNull();
  const zeroHistogram = zeroResult?.summary.renderCountHistogram ?? {};
  const hasDoubledFrame = Object.keys(zeroHistogram).some((count) => Number(count) >= 2);
  expect(hasDoubledFrame).toBe(true);
});

// P22 iter2-pacing D4 — a chase armed just before teardown, and still pending (not yet fired) at
// the moment `grid.destroy(true)` runs, must not re-enter render() afterwards. Against fce3e54
// this throws: the pending rAF fires one frame later, re-enters render() past destroy(), and
// dereferences an element SlickGrid's own destroy() already nulled — `!this.initialized` doesn't
// catch it because destroy() never clears that flag.
//
// Timing, deliberately engineered rather than raced: `chaseQuietMsOverride` (300ms) is set long
// enough that the scroll-triggered chase is still armed (re-arming, not yet rendering) by the time
// the tab-close click resolves — Playwright's own action + assertion round-trip reliably takes
// tens of ms, well under 300 — and short enough that the wait *after* close reliably crosses it,
// so the previously-armed callback's quiet check flips true and it attempts to render.
test('P22 iter2-pacing — tearing down the grid with a catch-up render still armed', async ({
  relaunch,
}) => {
  test.setTimeout(60_000);
  const { window: page } = await relaunch({ control: CONTROL, stream: PORT });
  await forceSlickEngine(page);

  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  const baselineStyles = await slickStyleTagCount(page);
  const baselineRetention = await page.evaluate(() =>
    JSON.stringify((window as unknown as { __kiraRetention: () => unknown }).__kiraRetention()),
  );
  const baselineBytes = await page.evaluate(() =>
    (window as unknown as { __kiraRetainedBytes: () => number }).__kiraRetainedBytes(),
  );

  await connectAndOpenSpikeGrid(page);
  await page.evaluate(() => {
    window.__kiraGridTuning ??= {};
    window.__kiraGridTuning.chaseQuietMsOverride = 300;
  });
  await rightViewport(page).evaluate((el) => {
    el.scrollTop = el.scrollHeight; // never-before-mounted territory — guarantees a runway deficit
  });
  await page.waitForTimeout(30); // arm the chase, stay well inside the 300ms quiet window

  await page.locator('[data-testid="tab"].is-active [data-testid="tab-close"]').click();
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(0);
  // Past the 300ms quiet window: the previously-armed callback (if D4 didn't cancel it) fires and
  // attempts to render against the now-torn-down grid.
  await page.waitForTimeout(500);

  expect(pageErrors).toEqual([]);
  await expect(page.locator('.slick-viewport')).toHaveCount(0);
  expect(await slickStyleTagCount(page)).toBe(baselineStyles);
  const closedRetention = await page.evaluate(() =>
    JSON.stringify((window as unknown as { __kiraRetention: () => unknown }).__kiraRetention()),
  );
  expect(closedRetention).toBe(baselineRetention);
  const closedBytes = await page.evaluate(() =>
    (window as unknown as { __kiraRetainedBytes: () => number }).__kiraRetainedBytes(),
  );
  expect(closedBytes).toBe(baselineBytes);
});

// P22 iter2-onset §6 — the gesture-onset defect's own sandbox-provable gates.
//
// What this proves, and what it does not. It gates the *mechanism*: no render pass sizes its
// runway as if the grid were standing still while the viewport is measurably moving. That is a
// property of this app's own sampling policy plus DOM event-listener ordering (spec-defined
// registration order on one target), so it is engine-independent and provable here — unlike the
// perceived "content isn't fully rendered for a few frames at the start of a fling" symptom that
// motivated it, which needs the real macOS compositor and is docs/PERF.md §2.1c's job.
//
// Three separate rest-to-motion transitions per recording, not one: the defect is one frame per
// gesture, so a single fling gives a one-frame margin and a flaky gate.
async function flingFromRest(
  page: import('@playwright/test').Page,
  viewport: ReturnType<typeof rightViewport>,
): Promise<void> {
  // Well past the sampler's own 150ms at-rest threshold (SlickGridHost.vue's velocity()), so each
  // burst below really does start from "at rest" and not from the tail of the previous one. 500ms,
  // not 150-250: `page.mouse.wheel` returns before WebKit's own scroll animation finishes, and that
  // animation's trailing 2-3px scroll events kept arriving ~95ms after the last wheel call resolved
  // here — enough to warm the sampler and hide the defect on bursts 2 and 3 of a 250ms-gap run.
  await page.waitForTimeout(500);
  // deltaY is deliberately small: the sampler discards a delta above
  // MAX_PLAUSIBLE_ROW_VELOCITY_PX_PER_FRAME (800) as a discrete jump rather than a fling, and
  // page.mouse.wheel's CDP round-trips can stack several ticks into one frame.
  await wheelFling(page, viewport, 40, 60);
}

/** The gate itself: frames that rendered while the viewport was measurably moving at a plausible
 *  fling speed, yet fed zero velocity into the runway arithmetic. `summary.staleVelocityFrames` is
 *  the same tally without the 800px guard — applied here so a stacked-wheel frame that the sampler
 *  legitimately treats as a discrete jump cannot be read as the defect. */
function staleRunwayFrames(
  frames: NonNullable<ReturnType<NonNullable<Window['__kiraScrollTrace']>['stop']>>['frames'],
): number {
  return frames.filter(
    (f) => f.renderCount > 0 && f.pxPerFrame > 0 && f.pxPerFrame <= 800 && f.runwayVelocity === 0,
  ).length;
}

test('P22 iter2-onset — a fresh gesture sizes its runway from that gesture, not from before it', async ({
  relaunch,
}) => {
  test.setTimeout(120_000);
  const { window: page } = await relaunch({ control: CONTROL, stream: PORT });
  await forceSlickEngine(page);
  await connectAndOpenSpikeGrid(page);
  const viewport = rightViewport(page);

  // --- (a) with the fix: no render sizes its runway at rest while the viewport is moving ---------
  await viewport.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.evaluate(() => window.__kiraScrollTrace?.start());
  for (let burst = 0; burst < 3; burst++) await flingFromRest(page, viewport);
  await page.waitForTimeout(300);
  const fixed = await page.evaluate(() => window.__kiraScrollTrace?.stop());
  expect(fixed).not.toBeNull();
  const fixedFrames = fixed?.frames ?? [];
  // The instrument reports something at all — otherwise the zero below would be vacuous.
  expect(fixed?.summary.runwayVelocity.max ?? 0).toBeGreaterThan(0);
  expect(staleRunwayFrames(fixedFrames)).toBe(0);

  // --- (b) THE REGRESSION GATE: the pacing fix still holds, on this same recording ---------------
  // P22 iter2-pacing's own invariant — at most one render pass per animation frame while a scroll
  // is live. The onset fix deliberately never touches `scheduleChase`'s quiescence gate (it widens
  // the *target* an already-scheduled render aims at, it does not let an extra render through), and
  // this is what proves that: three continuous, gapless wheel bursts, zero doubled frames.
  const fixedHistogram = fixed?.summary.renderCountHistogram ?? {};
  for (const count of Object.keys(fixedHistogram)) {
    expect(Number(count)).toBeLessThan(2);
  }

  // --- (c) freshVelocitySampleOverride = false reproduces the pre-fix behaviour ------------------
  // The self-verifying half of (a), exactly as T3 is for T1: if the pre-fix run does NOT show
  // stale-velocity frames, this harness is not reproducing the condition at all and (a) is a
  // tautology. Two of the three onsets, not three, so a burst that happens to start below the
  // dy > 20 render threshold (slickgrid dist/esm/index.js:10589) doesn't flake the gate.
  await viewport.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.evaluate(() => {
    window.__kiraGridTuning ??= {};
    window.__kiraGridTuning.freshVelocitySampleOverride = false;
  });
  await page.evaluate(() => window.__kiraScrollTrace?.start());
  for (let burst = 0; burst < 3; burst++) await flingFromRest(page, viewport);
  await page.waitForTimeout(300);
  const preFix = await page.evaluate(() => window.__kiraScrollTrace?.stop());
  await page.evaluate(() => {
    if (window.__kiraGridTuning) window.__kiraGridTuning.freshVelocitySampleOverride = undefined;
  });
  expect(preFix).not.toBeNull();
  expect(staleRunwayFrames(preFix?.frames ?? [])).toBeGreaterThanOrEqual(2);

  // --- (d) the per-frame chase gate is what makes (b) hold, not the wall-clock one --------------
  // P22 iter2-onset D2. CHASE_QUIET_MS is 24ms and frames here run p50 ~28 / p95 ~55 / max ~70ms
  // (and p50 32.1ms on the real Mac, docs/PERF.md §2.1c) — so "24ms since the last scroll event"
  // routinely stops meaning "no scroll event is driving this frame". With the frame gate removed,
  // leaving the shipped-at-a9dc570 wall-clock policy alone, this same fling doubles frames. This
  // is the load-bearing half of (b): without it, (b) would be passing on a gate that only holds
  // by accident. Uses wheelFling's own faster defaults — the harness the pacing pass's T1/T3 use.
  await viewport.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForTimeout(50);
  await page.evaluate(() => {
    window.__kiraGridTuning ??= {};
    window.__kiraGridTuning.chaseFrameGateOverride = false;
  });
  await page.evaluate(() => window.__kiraScrollTrace?.start());
  await wheelFling(page, viewport);
  await page.waitForTimeout(300);
  const msGateOnly = await page.evaluate(() => window.__kiraScrollTrace?.stop());
  await page.evaluate(() => {
    if (window.__kiraGridTuning) window.__kiraGridTuning.chaseFrameGateOverride = undefined;
  });
  expect(msGateOnly).not.toBeNull();
  const msGateHistogram = msGateOnly?.summary.renderCountHistogram ?? {};
  expect(Object.keys(msGateHistogram).some((count) => Number(count) >= 2)).toBe(true);
});

// P22 Pass B, C6/§5 D6, T6 — select-all's own cost gate. **Adopts** SlickHybridSelectionModel for
// select-all (SlickGridHost.vue's own onSelectAll comment): F2's O(rows × cols) hash inside
// `handleSelectedRangesChanged` is real, but this sandbox-provable measurement is what decides
// whether that's actually a problem, rather than assuming either way (§5 D6). If this ever regresses
// past 150ms, D6's own named bypass (rt().selection set directly, a `.kira-select-all` CSS class
// painting every `.slick-cell`, no range pushed into the model) is the fix — written down in the
// plan and in onSelectAll's own comment, not built speculatively.
test('P22 Pass B C6 — select-all completes within the 150ms sandbox gate, wide and tall', async ({
  relaunch,
}) => {
  test.setTimeout(60_000);

  // --- wide: spike_grid, 1 000 rows x 61 columns -------------------------------------------------
  const { window: wide } = await relaunch({ control: CONTROL, stream: PORT });
  await forceSlickEngine(wide);
  await connectAndOpenSpikeGrid(wide);
  const wideElapsedMs = await wide.evaluate(() => {
    const corner = document.querySelector<HTMLElement>('[data-testid="grid-select-all"]');
    if (!corner) throw new Error('select-all corner not found');
    const start = performance.now();
    corner.click();
    return performance.now() - start;
  });
  expect(wideElapsedMs).toBeLessThan(150);
  await expect.poll(() => wide.locator('.kira-cell-selected').count()).toBeGreaterThan(0);

  // --- tall: big_rows, 10 000 rows x 2 columns ----------------------------------------------------
  const BIG_CONNECTION_ID = 'conn-slick-selectall-big';
  const BIG_CONNECTION_SUMMARY = postgresConnectionSummary(
    BIG_CONNECTION_ID,
    'Select All Big DB',
    'amber',
  );
  const bigControl: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: {
        name: 'Select All Big DB',
        kind: 'postgres',
        color: 'amber',
        mode: 'fields',
        readOnly: false,
        host: '127.0.0.1',
        port: 5432,
        database: 'kira_test',
        username: 'postgres',
        password: null,
        uri: null,
        options: {},
        preconnect: null,
        preconnectSidecar: false,
        autoExplain: false,
      },
      response: BIG_CONNECTION_SUMMARY,
    },
    ...bigRowsFixture(BIG_CONNECTION_ID).control,
  ];
  const bigPort: PortSnapshot[] = [
    ...bigRowsFixture(BIG_CONNECTION_ID).port, // pageSize=100 — the tab's own initial load
    bigRowsHugePage(BIG_CONNECTION_ID), // pageSize=10000 — page-size-10000's own request
  ];

  const { window: tall } = await relaunch({ control: bigControl, stream: bigPort });
  await forceSlickEngine(tall);
  await tall.click('[data-testid="add-connection"]');
  await tall.click('[data-testid="connection-kind-postgres"]');
  await tall.fill('[data-testid="connection-name"]', 'Select All Big DB');
  await tall.fill('[data-testid="connection-host"]', '127.0.0.1');
  await tall.fill('[data-testid="connection-port"]', '5432');
  await tall.fill('[data-testid="connection-database"]', 'kira_test');
  await tall.fill('[data-testid="connection-username"]', 'postgres');
  await tall.click('[data-testid="color-amber"]');
  await tall.click('[data-testid="connection-save"]');
  await expect(tall.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  const connRow = tall.locator('[data-testid="tree-row"][data-kind="connection"]');
  await openRowMenu(tall, '');
  await tall.click('[data-testid="menu-item-connect"]');
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });
  await expandRow(tall, '');
  await expandRow(tall, DB_PATH);
  await expandRow(tall, APP_PATH);
  const bigRowsRow = await findRow(tall, BIG_ROWS_PATH);
  await bigRowsRow.dblclick();
  await expect(tall.locator('[data-testid="data-grid"] .slick-cell')).not.toHaveCount(0);
  await tall.click('[data-testid="page-size-10000"]');
  await expect
    .poll(async () => tall.locator('[data-testid="data-grid"] .slick-cell').count(), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  const tallElapsedMs = await tall.evaluate(() => {
    const corner = document.querySelector<HTMLElement>('[data-testid="grid-select-all"]');
    if (!corner) throw new Error('select-all corner not found');
    const start = performance.now();
    corner.click();
    return performance.now() - start;
  });
  expect(tallElapsedMs).toBeLessThan(150);
  await expect.poll(() => tall.locator('.kira-cell-selected').count()).toBeGreaterThan(0);
});

// P22 Pass B, C12/§9.2 T7 — "the F5 merge cost" (Pass A §8.6 item 2's own open question, discharged
// with a measurement, not an argument): with a 10 000-match search active, a selection change must
// still land inside the same 150ms sandbox bound T6's own select-all gate uses. `kira-search` is
// explicitly the one CSS layer §5 D5's own table allows to be O(matches) rather than
// O(perimeter ∩ rendered) — this is what proves that choice doesn't tax anything *else* (the
// selection's own O(area) select-all cost, C6) once a large search result is sitting on top of it.
// Fails -> D5's own named fallback (a rendered-range ± hysteresis band for kira-search) lands in
// this same commit.
test('P22 Pass B C12 T7 — select-all stays within the 150ms sandbox gate with 10 000 search matches active', async ({
  relaunch,
}) => {
  test.setTimeout(60_000);

  const BIG_CONNECTION_ID = 'conn-slick-search-big';
  const BIG_CONNECTION_SUMMARY = postgresConnectionSummary(
    BIG_CONNECTION_ID,
    'Search Big DB',
    'cyan',
  );
  const bigControl: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: {
        name: 'Search Big DB',
        kind: 'postgres',
        color: 'cyan',
        mode: 'fields',
        readOnly: false,
        host: '127.0.0.1',
        port: 5432,
        database: 'kira_test',
        username: 'postgres',
        password: null,
        uri: null,
        options: {},
        preconnect: null,
        preconnectSidecar: false,
        autoExplain: false,
      },
      response: BIG_CONNECTION_SUMMARY,
    },
    ...bigRowsFixture(BIG_CONNECTION_ID).control,
  ];
  const bigPort: PortSnapshot[] = [
    ...bigRowsFixture(BIG_CONNECTION_ID).port, // pageSize=100 — the tab's own initial load
    bigRowsHugePage(BIG_CONNECTION_ID), // pageSize=10000 — page-size-10000's own request
  ];

  const { window: page } = await relaunch({ control: bigControl, stream: bigPort });
  await forceSlickEngine(page);
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', 'Search Big DB');
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '5432');
  await page.fill('[data-testid="connection-database"]', 'kira_test');
  await page.fill('[data-testid="connection-username"]', 'postgres');
  await page.click('[data-testid="color-cyan"]');
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  const connRow = page.locator('[data-testid="tree-row"][data-kind="connection"]');
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });
  await expandRow(page, '');
  await expandRow(page, DB_PATH);
  await expandRow(page, APP_PATH);
  const bigRowsRow = await findRow(page, BIG_ROWS_PATH);
  await bigRowsRow.dblclick();
  await expect(page.locator('[data-testid="data-grid"] .slick-cell')).not.toHaveCount(0);
  await page.click('[data-testid="page-size-10000"]');
  await expect
    .poll(async () => page.locator('[data-testid="data-grid"] .slick-cell').count(), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  // 10 000 matches, one per row: every big_rows `id` is a bare digit string (bigRowsRow's own
  // shape), so a whole-cell digit-run regex matches the `id` column exactly once per row and
  // never the `hash` column (32 hex chars, never all-digit in this fixture's md5 seed).
  await page.click('[data-testid="toolbar-search"]');
  await expect(page.locator('[data-testid="search-toolbar"]')).toBeVisible();
  await page.click('[data-testid="search-regex"]');
  await page.fill('[data-testid="search-input"]', '^\\d+$');
  await expect(page.locator('[data-testid="search-count"]')).toContainText('of 10,000', {
    timeout: 15_000,
  });

  const elapsedMs = await page.evaluate(() => {
    const corner = document.querySelector<HTMLElement>('[data-testid="grid-select-all"]');
    if (!corner) throw new Error('select-all corner not found');
    const start = performance.now();
    corner.click();
    return performance.now() - start;
  });
  expect(elapsedMs).toBeLessThan(150);
  await expect.poll(() => page.locator('.kira-cell-selected').count()).toBeGreaterThan(0);
});

// P22 Pass B, C9/§9.2 T8 — the pacing invariant (T1's own histogram-all-1 assertion, above) held
// again with N staged insert rows on screen. D9's own §0.3 acknowledgement: this is the one place
// this pass returns DOM from a formatter (the insert region's own `<input>`, self-contained and
// never re-touched by SlickGrid once built — see `cellFormatter`'s own comment, SlickGridHost.vue)
// against `-iter2-pacing` D5's measured "text, never DOM" rule, so it gets its own gate, landed in
// the same commit that adds the exception (§9.2's own text) so a regression stays bisectable to it.
test('P22 Pass B C9 — the pacing invariant holds with N staged insert rows on screen', async ({
  relaunch,
}) => {
  test.setTimeout(60_000);
  const { window: page } = await relaunch({ control: CONTROL, stream: PORT });
  await forceSlickEngine(page);
  await connectAndOpenSpikeGrid(page);
  const viewport = rightViewport(page);

  async function fling(): Promise<{ histogram: Record<string, number>; p95: number }> {
    await viewport.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(50);
    await page.evaluate(() => window.__kiraScrollTrace?.start());
    await wheelFling(page, viewport);
    await page.waitForTimeout(300);
    const result = await page.evaluate(() => window.__kiraScrollTrace?.stop());
    expect(result).not.toBeNull();
    return {
      histogram: result?.summary.renderCountHistogram ?? {},
      p95: result?.summary.renderMs.p95 ?? 0,
    };
  }

  const before = await fling();
  for (const count of Object.keys(before.histogram)) {
    expect(Number(count)).toBeLessThan(2);
  }

  // N staged insert rows — a handful, matching D9's own "typically 1-5, never scrolled past in
  // bulk" scope note.
  for (let i = 0; i < 5; i++) {
    await page.click('[data-testid="toolbar-add-row"]');
  }
  await expect(page.locator('[data-testid="grid-row-insert"]')).toHaveCount(5);

  const after = await fling();
  for (const count of Object.keys(after.histogram)) {
    expect(Number(count)).toBeLessThan(2);
  }
  // Not a tight timing claim — this sandbox has no real compositor (§7.1's own line) — a generous
  // same-run bound that only fails if the insert region's own DOM rode along on every scroll-
  // driven render instead of staying self-contained (the actual regression this gate exists to
  // catch), not on ordinary sandbox timing noise.
  expect(after.p95).toBeLessThan(before.p95 * 3 + 5);
});
