import { createHash } from 'node:crypto';
import type { ControlSnapshot, PortSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import {
  BIG_ROWS_META,
  BIG_ROWS_PATH,
  bigRowsFixture,
  bigRowsHugePage,
  connectAndExpandControl,
  DB_PATH,
  postgresConnectionSummary,
} from './support/postgresFixture';
import { expandRow, findRow, openRowMenu } from './support/tree';

// P22 regular-table spike — the sandbox half of the exit criteria
// (docs/v1.1/plans/P22-regular-table-spike.md §6). Nothing here can settle the real question,
// which is how a real macOS momentum scroll feels (that is the human protocol in §7, on hardware
// this container does not have). What it *can* settle, and what the whole spike rests on:
//
//   1. the bridge renders real decoded page data, cell for cell, through the app's existing
//      `cell()` / decode-cache pipeline;
//   2. a scroll moves the window correctly — new rows, correct values, correct gutter numbers;
//   3. **the `<td>` elements are pooled**: not one DOM node is created or destroyed for a row
//      entering the render window. This is the single structural claim that made regular-table
//      worth spiking at all (SlickGrid's `removeRowFromCache` destroys and rebuilds a node per
//      entering row), and it is directly observable from here;
//   4. the scroll trace is wired, so the human protocol has something to record.
//
// The incumbent engine is untouched: every other spec in this directory keeps running against it.

const CONNECTION_ID = 'conn-regular-table';
const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Regular Table DB', 'grey');

const CONTROL: ControlSnapshot[] = [
  { channel: IPC.connectionsList, response: [] },
  {
    channel: IPC.connectionsCreate,
    args: {
      name: 'Regular Table DB',
      kind: 'postgres',
      color: 'grey',
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
  ...connectAndExpandControl(CONNECTION_ID),
  {
    channel: IPC.treeDescribe,
    args: { connectionId: CONNECTION_ID, path: BIG_ROWS_PATH, refresh: false, tabId: null },
    response: { meta: BIG_ROWS_META, source: 'server' },
  },
];

const PORT: PortSnapshot[] = [
  ...bigRowsFixture(CONNECTION_ID).port,
  bigRowsHugePage(CONNECTION_ID),
];

/** `app.big_rows`' own value rule (postgresFixture.ts's `bigRowsRow`), restated for assertions. */
function hashOf(id: number): string {
  return createHash('md5').update(String(id)).digest('hex');
}

test('regular-table engine — renders decoded data, scrolls, and pools its cells', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: CONTROL, stream: PORT });

  // The switch is read once, when DataView.vue is created — so it has to be set before the tab is
  // opened, not before the page loads.
  await page.evaluate(() => {
    window.__kiraGridEngine = 'regular';
  });

  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', 'Regular Table DB');
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '5432');
  await page.fill('[data-testid="connection-database"]', 'kira_test');
  await page.fill('[data-testid="connection-username"]', 'postgres');
  await page.click('[data-testid="color-grey"]');
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
  await expandRow(page, 'database:kira_test/schema:app');
  const bigRowsRow = await findRow(page, BIG_ROWS_PATH);
  await bigRowsRow.dblclick();

  // 1. The spike's own host mounted, and the incumbent grid did not.
  const host = page.locator('[data-testid="regular-table-host"]');
  await expect(host).toBeVisible();
  await expect(page.locator('[data-testid="data-grid"]')).toHaveCount(0);

  const grid = page.locator('kira-regular-table');
  await expect(grid.locator('tbody tr').first()).toBeVisible();

  // 2. Real decoded values, through the real bridge — the page's own `cell()`, not a fixture echo.
  await expect(page.locator('[data-testid="grid-header-cell"][data-column="id"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="grid-header-cell"][data-column="hash"]')).toHaveCount(1);
  for (const row of [0, 1, 5]) {
    await expect(page.locator(`td[data-row="${row}"][data-column="id"]`)).toHaveText(
      String(row + 1),
    );
    await expect(page.locator(`td[data-row="${row}"][data-column="hash"]`)).toHaveText(
      hashOf(row + 1),
    );
  }
  // The gutter is the row's position in the whole result set, one-based (P24 D4).
  await expect(page.locator('th[data-row="0"]')).toHaveText('1');

  await page.click('[data-testid="page-size-10000"]');
  await expect
    .poll(() => grid.evaluate((el) => el.scrollHeight), { timeout: 15_000 })
    .toBeGreaterThan(200_000);

  // 3. The pooling claim, measured directly. Every currently-rendered `<td>`/`<th>` is stamped with
  // a marker property (a JS expando, invisible to the library and to CSS); the grid is then
  // scrolled far enough that *every* row in the window is replaced. If regular-table pooled its
  // cells, the same nodes are still there afterwards carrying their markers, and the cells now
  // hold different text. If it created new nodes per entering row — SlickGrid's behaviour — the
  // survivor count collapses.
  const pooling = await grid.evaluate(async (el) => {
    const cells = () => Array.from(el.querySelectorAll('tbody td, tbody th'));
    const stamp = (n: Element, i: number) => {
      (n as Element & { __kiraPoolMark?: number }).__kiraPoolMark = i;
    };
    const marked = (n: Element) => (n as Element & { __kiraPoolMark?: number }).__kiraPoolMark;

    const before = cells();
    before.forEach(stamp);
    const beforeCount = before.length;
    const beforeFirstText = el.querySelector('tbody td')?.textContent ?? '';

    el.scrollTop = 40_000;
    // Two frames of settling: regular-table's scroll path is predraw -> rAF -> synchronous commit
    // (events.ts `_on_scroll`), so one frame is not always enough.
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }

    const after = cells();
    return {
      beforeCount,
      afterCount: after.length,
      survivors: after.filter((n) => marked(n) !== undefined).length,
      created: after.filter((n) => marked(n) === undefined).length,
      beforeFirstText,
      afterFirstText: el.querySelector('tbody td')?.textContent ?? '',
      afterFirstRow: el.querySelector('tbody td')?.getAttribute('data-row') ?? '',
    };
  });

  expect(pooling.beforeCount).toBeGreaterThan(0);
  // The window really did move — a scroll that changed nothing would prove nothing about pooling.
  expect(pooling.afterFirstText).not.toBe(pooling.beforeFirstText);
  expect(Number(pooling.afterFirstRow)).toBeGreaterThan(100);
  // …and every cell now on screen is one of the nodes that was already there. This is the whole
  // hypothesis: zero DOM construction for a row entering the render window.
  expect(pooling.created).toBe(0);
  expect(pooling.survivors).toBe(pooling.afterCount);

  // 4. The scrolled-to window shows the right decoded values, addressed by page row index.
  const scrolledRow = Number(pooling.afterFirstRow);
  await expect(page.locator(`td[data-row="${scrolledRow}"][data-column="hash"]`)).toHaveText(
    hashOf(scrolledRow + 1),
  );

  // 5. The scroll trace is wired to this engine — `rows` and a real band come from the host's own
  // provider, not from `measureMountedBand`'s selector, so a zero here means the A/B protocol
  // would record nothing.
  await page.evaluate(() => window.__kiraScrollTrace?.start());
  const trace = await grid.evaluate(async (el) => {
    const total = Math.max(0, el.scrollHeight - el.clientHeight);
    for (let i = 1; i <= 5; i++) {
      el.scrollTop = Math.round((total * i) / 20);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    return window.__kiraScrollTrace?.stop();
  });

  expect(trace).not.toBeNull();
  expect(trace?.frames.length).toBeGreaterThan(0);
  expect(trace?.frames.some((f) => f.rows > 0)).toBe(true);
  expect(trace?.frames.some((f) => f.mountedBottom > f.mountedTop)).toBe(true);
  // A commit was timed at least once — `renderMs` is the number the real-Mac A/B reports.
  expect(trace?.frames.some((f) => f.notified)).toBe(true);

  // 6. The runway knob (`__kiraGridTuning.regularRunwayPx`) actually widens the rendered window,
  // and — the part that is easy to get wrong — does not distort regular-table's own percent-based
  // scrollTop -> row mapping. Without it this engine renders the visible viewport and nothing
  // else, which is the single biggest open risk for a real fling.
  const runway = await grid.evaluate(async (el) => {
    const rowsAt = () => el.querySelectorAll('tbody tr').length;
    const topRow = () => Number(el.querySelector('tbody td')?.getAttribute('data-row') ?? -1);
    const settle = async () => {
      for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
    };

    el.scrollTop = 28_000;
    await settle();
    const withoutRunway = { rows: rowsAt(), top: topRow() };

    window.__kiraGridTuning = { ...window.__kiraGridTuning, regularRunwayPx: 600 };
    el.scrollTop = 28_028;
    await settle();
    const withRunway = { rows: rowsAt(), top: topRow() };

    // Scrolling back to the same offset must land on the same first row as it did without the
    // runway — the mapping is unchanged, only the window is longer.
    el.scrollTop = 28_000;
    await settle();
    const backAtSameOffset = topRow();

    window.__kiraGridTuning = { ...window.__kiraGridTuning, regularRunwayPx: 0 };
    return { withoutRunway, withRunway, backAtSameOffset };
  });

  expect(runway.withRunway.rows).toBeGreaterThan(runway.withoutRunway.rows);
  // Within one row. regular-table's scroll mapping is percent-of-panel, not `scrollTop / h`, and
  // its two height inputs (the clip's `clientHeight` and the element's) differ by a scrollbar
  // gutter — so the algebra that makes the runway mapping-neutral (element.ts's `runwayPx`) is
  // exact only when those two agree. The residual is sub-row and shows up as a ±1 shift across a
  // `floor()`, which is harmless for an A/B and is not worth over-fitting an assertion to.
  expect(Math.abs(runway.backAtSameOffset - runway.withoutRunway.top)).toBeLessThanOrEqual(1);
});

test('regular-table engine — selection, context menu and copy run on the shared feature code', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: CONTROL, stream: PORT });
  await page.evaluate(() => {
    window.__kiraGridEngine = 'regular';
  });

  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', 'Regular Table DB');
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '5432');
  await page.fill('[data-testid="connection-database"]', 'kira_test');
  await page.fill('[data-testid="connection-username"]', 'postgres');
  await page.click('[data-testid="color-grey"]');
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
  await expandRow(page, 'database:kira_test/schema:app');
  await (await findRow(page, BIG_ROWS_PATH)).dblclick();
  await expect(page.locator('[data-testid="regular-table-host"]')).toBeVisible();

  // A plain click selects one cell, in the app's own `{ kind: 'cell' }` shape — the same shape
  // menu.ts, clipboardFormats.ts and the cell-editor dock all already consume.
  const target = page.locator('td[data-row="2"][data-column="hash"]');
  await target.click();
  await expect(target).toHaveClass(/selected/);

  // Shift-click extends it to a range, and the perimeter edge classes (P42 D21) land only on the
  // selection's outer boundary — the seam between two selected cells carries neither.
  await page.locator('td[data-row="4"][data-column="hash"]').click({ modifiers: ['Shift'] });
  await expect(page.locator('td[data-column="hash"].selected')).toHaveCount(3);
  await expect(page.locator('td[data-row="2"][data-column="hash"]')).toHaveClass(/sel-t/);
  await expect(page.locator('td[data-row="3"][data-column="hash"]')).not.toHaveClass(/sel-t/);

  // The cell context menu is menu.ts's own `cellMenu`, unchanged — reached through the host's
  // `getMeta`-based adapter rather than through DataGrid.vue's `closest('.grid-cell')`.
  await target.click({ button: 'right' });
  const menu = page.locator('[data-testid="context-menu"]');
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-testid="menu-item-copy"]')).toBeVisible();
  await expect(menu.locator('[data-testid="menu-item-filter-by-value"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // The row context menu, off the gutter.
  await page.locator('th[data-row="1"]').click({ button: 'right' });
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-testid="menu-item-copy-rows"]')).toBeVisible();
  await page.keyboard.press('Escape');

  // The header context menu, off a column header.
  await page.locator('[data-testid="grid-header-cell"][data-column="id"]').click({
    button: 'right',
  });
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-testid="menu-item-sort-asc"]')).toBeVisible();
  await page.keyboard.press('Escape');
});
