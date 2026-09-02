import { DATA_OP } from '@shared/protocol/data-ops';
import type { ColumnDescriptor } from '@shared/protocol/page';
import type { ControlSnapshot, PortSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import {
  APP_CHILDREN,
  APP_PATH,
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

  // Counts only SlickGrid's OWN per-instance <style> element (F8's own createCssRules/
  // removeCssRules), not every <style> tag in <head> — opening a data tab also mounts
  // FilterToolbar.vue's CodeMirror-based WHERE/ORDER BY fields, and CodeMirror 6's own
  // StyleModule injects one *global*, content-hash-deduplicated <style> the first time any editor
  // uses it, by design never removed (confirmed empirically: its rules are `.ͼ1.cm-focused {...}`,
  // nothing to do with this grid). SlickGrid's own rules are always scoped `.<uid> .slick-header-
  // column { ... }` (createCssRules, dist/esm/index.mjs read this session) — a real signature the
  // CodeMirror one can never share.
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
