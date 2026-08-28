import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { measureClickToDom, measureScrollResponses, percentile } from './support/measure';
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  type PgFixture,
  seedScrollFixture,
  startPostgres,
} from './support/pg';
import { expandRow, findRow, openRowMenu } from './support/tree';

// P12 §2.1's real interaction budgets (D5/D6), measured for real against §3 of
// docs/v1/plans/P12-hardening.md — tests/e2e/perf.spec.ts's rAF/DOM-cell tripwires stay unchanged
// alongside these and are not superseded by them (D7).
test.describe.configure({ timeout: 180_000 });

let pg: PgFixture | null = null;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  if (!(await isDockerAvailable())) {
    test.skip(true, DOCKER_UNAVAILABLE_MESSAGE);
    return;
  }
  pg = await startPostgres();
  await seedScrollFixture(pg.uri);
});

test.afterAll(async () => {
  await pg?.stop();
});

const DB_PATH = 'database:kira_test';
const APP_PATH = `${DB_PATH}/schema:app`;
const BIG_ROWS_PATH = `${APP_PATH}/table:big_rows`;
const WIDE_TABLE_PATH = `${APP_PATH}/table:wide_table`;
const SCROLL_GRID_PATH = `${APP_PATH}/table:scroll_grid`;

// Mirrors DataGrid.vue's own OVERSCAN_PX (P29 D2) — the coverage below is the deterministic proof
// that both axes actually render this much buffer, not a re-statement of the app's own constant.
const OVERSCAN_PX = 560;

// Mirrors DataGrid.vue's own GUTTER_WIDTH — header/data cells are positioned in `.grid-sizer`'s
// content-space coordinates (the same space `scrollLeft` operates over), and that space reserves
// GUTTER_WIDTH px for the sticky row-number gutter before column 0's content begins. So even at
// scrollLeft=0, the leftmost renderable column position can never be less than GUTTER_WIDTH — the
// column-axis overscan check below clamps against that floor instead of 0.
const GUTTER_WIDTH = 56;

// A script-driven `scrollTop` assignment's native `scroll` event is deferred to Chromium's next
// "update the rendering" step (the same per-frame cadence requestAnimationFrame uses — see
// measure.ts's measureScrollResponses doc comment for how this was proven). Under this
// environment's main-thread load that deferral isn't bounded to a single frame, so a fixed
// two-rAF wait isn't enough: a scroll fired inside findRow's search loop can still be in flight
// well after that, and ContextMenu.vue's scroll-anywhere-closes-menu listener then closes a
// caller's just-opened menu as if it were stale. Instead, track the most recent 'scroll' event
// globally and poll until a quiet period has passed with no new one (or a generous cap elapses).
function logStats(label: string, values: number[]): void {
  const p50 = percentile(values, 50);
  const p95 = percentile(values, 95);
  console.log(`budgets.spec.ts ${label}: p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms`);
}

// P18 addendum D26. `measureClickToDom`'s "arm the observer and read `performance.now()` inside
// one synchronous evaluate() call" trick doesn't transfer directly to a keystroke: unlike
// `.click()`, there is no script-callable way to make an element genuinely receive typed input —
// it has to go through Playwright's own `keyboard.press`, a real Node round trip. So this arms the
// observer (and its start time) in one evaluate() call, triggers the press from Node, then reads
// back a Promise that already resolved entirely in page time — every timestamp compared is
// `performance.now()` inside the same page, so there's no cross-process clock skew, but the
// Node-side round trip between arming and pressing does add some fixed overhead to every sample
// (present equally in all 20, so p50 stays a meaningful comparison point even if slightly inflated
// versus a real keystroke's dispatch latency).
async function measureKeyToPopup(page: Page, key: string): Promise<number> {
  await page.evaluate(() => {
    const w = window as unknown as { __kiraKeyProbe?: Promise<number>; __kiraKeyStart?: number };
    w.__kiraKeyProbe = new Promise<number>((resolve) => {
      const observer = new MutationObserver(() => {
        if (!document.querySelector('.cm-tooltip-autocomplete')) return;
        observer.disconnect();
        resolve(performance.now() - (w.__kiraKeyStart as number));
      });
      observer.observe(document.body, { childList: true, subtree: true });
      w.__kiraKeyStart = performance.now();
    });
  });
  await page.keyboard.press(key);
  return page.evaluate(
    () => (window as unknown as { __kiraKeyProbe: Promise<number> }).__kiraKeyProbe,
  );
}

test('interaction budgets — scroll, cell→editor, cached tab switch, cached tree expand', async ({
  kira,
  consoleErrors,
}) => {
  test.setTimeout(180_000);
  if (!pg) throw new Error('postgres fixture did not start');
  const { window: page } = kira;

  const connectionId = await page.evaluate(
    (cfg) =>
      window.kira
        .connectionsCreate({
          name: 'Budgets DB',
          kind: 'postgres',
          color: 'cyan',
          mode: 'fields',
          readOnly: false,
          host: cfg.host,
          port: cfg.port,
          database: cfg.database,
          username: cfg.username,
          password: cfg.password,
          uri: null,
          options: {},
          preconnect: null,
          preconnectSidecar: false,
        })
        .then((c) => c.id),
    {
      host: pg.config.host,
      port: pg.config.port,
      database: pg.config.database,
      username: pg.config.username,
      password: pg.config.password,
    },
  );
  void connectionId;

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

  // --- 1. scroll response: trigger -> DOM committed, p50 <= 8ms (see note below on p95) -----
  await bigRowsRow.dblclick();
  const grid = page.locator('[data-testid="data-grid"]');
  await expect(grid).toBeVisible();
  // Captured while big_rows is still the only open tab — 1b below opens scroll_grid in a second
  // tab and must switch back to this one before item 2 continues.
  const bigRowsFirstTabId = await page
    .locator('[data-testid="tab"]')
    .first()
    .getAttribute('data-tab-id');
  await page.click('[data-testid="page-size-10000"]');
  // A plain "some gutter cell exists" poll is already true from the pre-click page-size-100
  // render, so it passes before the 10000-row page has actually loaded — scrollHeight only grows
  // to its full ~280 000px once the new page's rowCount lands, so wait on that instead.
  await expect
    .poll(() => grid.evaluate((el) => el.scrollHeight), { timeout: 15_000 })
    .toBeGreaterThan(200_000);

  const { workDeltas: scrollDeltas, e2eDeltas: scrollE2eDeltas } = await measureScrollResponses(
    page,
    '[data-testid="data-grid"]',
    20,
  );
  logStats('scroll response (work)', scrollDeltas);
  logStats('scroll response (end-to-end)', scrollE2eDeltas);
  // SPEC.md §2's 8ms figure is explicitly "(120 Hz displays)" — a per-frame work budget, not a
  // display-independent latency. The end-to-end number (trigger → DOM commit, logged above) is
  // dominated by two stacked frame-scheduling waits that aren't app work — see measure.ts's
  // measureScrollResponses doc comment — so it stays logged only, for docs/PERF.md, not gated.
  // The budget is asserted against the work-only number instead: DataGrid.vue's own mark of when
  // its post-scheduling work actually starts, to the same DOM-commit signal.
  expect(percentile(scrollDeltas, 50)).toBeLessThanOrEqual(8);
  // Still a real regression guard: no sample's own work may run long, which would indicate the
  // app itself — not frame scheduling — is slow.
  expect(Math.max(...scrollDeltas)).toBeLessThanOrEqual(50);

  // --- 1b. scroll_grid (60 cols x 5000 rows, P29 D14): the wide-AND-tall shape neither big_rows
  // nor wide_table alone can show (F8) — horizontal response, vertical response on a wide table,
  // the deterministic overscan-coverage invariant on both axes, a DOM-size bound, and the direct
  // proof that a sub-row scroll mutates nothing. -----------------------------------------------
  await openRowMenu(page, SCROLL_GRID_PATH);
  await page.click('[data-testid="menu-item-open-data-new-tab"]');
  const scrollGrid = page.locator('[data-testid="data-grid"]');
  await expect(scrollGrid).toBeVisible();
  // Closed at the end of this block, below — item 3 asserts an exact tab count of 2, and this
  // tab must not still be open by the time it runs.
  const scrollGridTabId = await page
    .locator('[data-testid="tab"].is-active')
    .getAttribute('data-tab-id');
  await expect
    .poll(() => scrollGrid.evaluate((el) => el.scrollWidth), { timeout: 15_000 })
    .toBeGreaterThan(2000);

  const { workDeltas: horizontalDeltas, e2eDeltas: horizontalE2eDeltas } =
    await measureScrollResponses(page, '[data-testid="data-grid"]', 20, 'horizontal');
  logStats('scroll response (horizontal, work)', horizontalDeltas);
  logStats('scroll response (horizontal, end-to-end)', horizontalE2eDeltas);
  expect(percentile(horizontalDeltas, 50)).toBeLessThanOrEqual(8);
  expect(Math.max(...horizontalDeltas)).toBeLessThanOrEqual(50);

  await scrollGrid.evaluate((el) => {
    el.scrollLeft = 0;
  });
  const { workDeltas: wideVerticalDeltas, e2eDeltas: wideVerticalE2eDeltas } =
    await measureScrollResponses(page, '[data-testid="data-grid"]', 20);
  logStats('scroll response (vertical, wide table, work)', wideVerticalDeltas);
  logStats('scroll response (vertical, wide table, end-to-end)', wideVerticalE2eDeltas);
  expect(percentile(wideVerticalDeltas, 50)).toBeLessThanOrEqual(8);
  expect(Math.max(...wideVerticalDeltas)).toBeLessThanOrEqual(50);

  // The rendered column window extends >= OVERSCAN_PX beyond both viewport edges at every
  // position, clamped at the table's own edges — this is the assertion that fails against the
  // pre-P29 code (zero column overscan) and passes once the buffer is symmetric with the row axis.
  const colPositions = 10;
  const { scrollWidth, clientWidth } = await scrollGrid.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  const maxScrollLeft = Math.max(0, scrollWidth - clientWidth);
  for (let i = 0; i <= colPositions; i++) {
    const target = Math.round((maxScrollLeft * i) / colPositions);
    await scrollGrid.evaluate((el, t) => {
      el.scrollLeft = t;
    }, target);
    await page.waitForTimeout(50);
    // offsetLeft/offsetWidth, not getBoundingClientRect — a header cell's own `left` CSS value
    // (what these read) is in the same content-space coordinate system scrollLeft already is,
    // with no viewport/scroll conversion needed; a bounding-rect read would need one and is easy
    // to get backwards.
    const bounds = await page.evaluate(() => {
      const els = Array.from(
        document.querySelectorAll('[data-testid="grid-header-cell"]'),
      ) as HTMLElement[];
      if (els.length === 0) return null;
      let left = Number.POSITIVE_INFINITY;
      let right = Number.NEGATIVE_INFINITY;
      let maxWidth = 0;
      for (const el of els) {
        if (el.offsetLeft < left) left = el.offsetLeft;
        if (el.offsetLeft + el.offsetWidth > right) right = el.offsetLeft + el.offsetWidth;
        if (el.offsetWidth > maxWidth) maxWidth = el.offsetWidth;
      }
      return { left, right, maxWidth };
    });
    if (!bounds) throw new Error('no header cells rendered');
    // Columns are variable width (40-480px, per columns.ts) — visibleColumnRange()'s "expand a
    // column at a time until overscanPx is covered" loop can only stop on a column boundary, so
    // it may cover up to one column's width more or less than the exact OVERSCAN_PX target. A
    // fixed pixel fudge can't bound that (it isn't a function of the table's own column widths);
    // bounds.maxWidth (the widest column actually rendered at this boundary) can.
    expect(bounds.left).toBeLessThanOrEqual(
      Math.max(GUTTER_WIDTH, target - OVERSCAN_PX) + bounds.maxWidth + 1,
    );
    expect(bounds.right).toBeGreaterThanOrEqual(
      Math.min(scrollWidth, target + clientWidth + OVERSCAN_PX) - bounds.maxWidth - 1,
    );
  }

  // The same invariant on the row axis, so the two axes are provably symmetric. Rows have the
  // same "reserved space before content" structure columns do — every row's own `top` style is
  // offset by one rowHeight for the sticky header row above it — but rowHeight itself is a
  // settings-dependent value (compact vs. default density), not a fixed constant like
  // GUTTER_WIDTH, so it's measured off a real rendered row instead of mirrored as a literal.
  await scrollGrid.evaluate((el) => {
    el.scrollLeft = 0;
  });
  const rowPositions = 10;
  const { scrollHeight, clientHeight } = await scrollGrid.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  const headerRowHeight = await page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('[data-testid="grid-row"]');
    return row ? row.offsetHeight : 0;
  });
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
  for (let i = 0; i <= rowPositions; i++) {
    const target = Math.round((maxScrollTop * i) / rowPositions);
    await scrollGrid.evaluate((el, t) => {
      el.scrollTop = t;
    }, target);
    await page.waitForTimeout(50);
    // offsetTop/offsetHeight, same reasoning as the column block above — a row's own `top` CSS
    // value is already in scrollTop's coordinate space.
    const rowBounds = await page.evaluate(() => {
      const els = Array.from(
        document.querySelectorAll('[data-testid="grid-row"]'),
      ) as HTMLElement[];
      if (els.length === 0) return null;
      let top = Number.POSITIVE_INFINITY;
      let bottom = Number.NEGATIVE_INFINITY;
      for (const el of els) {
        if (el.offsetTop < top) top = el.offsetTop;
        if (el.offsetTop + el.offsetHeight > bottom) bottom = el.offsetTop + el.offsetHeight;
      }
      return { top, bottom };
    });
    if (!rowBounds) throw new Error('no grid rows rendered');
    // Same reasoning as the column block's bounds.maxWidth tolerance: rowRange's floor(scrollTop /
    // rowHeight) can identify a row boundary one rowHeight short of the exact continuous target
    // (e.g. scrollTop=88, rowHeight=28: the row spanning content-y [84,112) contains 88, but
    // floor(88/28)=3 skips straight to the row starting at 112) — invisible to real users since it
    // only ever bites at the overscan window's own edge, far outside the viewport, but a fixed
    // pixel fudge can't absorb it the way one rowHeight's worth of tolerance can.
    expect(rowBounds.top).toBeLessThanOrEqual(
      Math.max(headerRowHeight, target - OVERSCAN_PX) + headerRowHeight + 1,
    );
    expect(rowBounds.bottom).toBeGreaterThanOrEqual(
      Math.min(scrollHeight, target + clientHeight + OVERSCAN_PX) - headerRowHeight - 1,
    );

    // The DOM stays bounded even at the overscan's own worst case (D3).
    const cellCount = await page.locator('[data-testid="grid-cell"]').count();
    expect(cellCount).toBeLessThan(2500);
  }

  // A sub-row scroll mutates nothing (D4); crossing a row boundary does.
  await scrollGrid.evaluate((el) => {
    el.scrollTop = 1000;
  });
  await page.waitForTimeout(100);
  const subRowMutations = await scrollGrid.evaluate(async (el) => {
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

  const rowHeight = await scrollGrid.evaluate((el) => {
    const row = el.querySelector('[data-testid="grid-row"]');
    return row ? row.getBoundingClientRect().height : 28;
  });
  const crossRowMutations = await scrollGrid.evaluate(async (el, delta) => {
    let count = 0;
    const observer = new MutationObserver((records) => {
      count += records.length;
    });
    observer.observe(el, { childList: true, subtree: true, attributes: true });
    el.scrollTop += delta;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    observer.disconnect();
    return count;
  }, rowHeight);
  expect(crossRowMutations).toBeGreaterThan(0);

  // Close this tab and reactivate big_rows — every remaining item in this test assumes it's the
  // only, active tab (item 3 asserts an exact count of 2 once it opens its own second tab).
  if (!scrollGridTabId || !bigRowsFirstTabId) throw new Error('tab ids not found');
  await page
    .locator(`[data-testid="tab"][data-tab-id="${scrollGridTabId}"] [data-testid="tab-close"]`)
    .click();
  await page.click(`[data-testid="tab"][data-tab-id="${bigRowsFirstTabId}"]`);
  await expect(page.locator('[data-testid="grid-header-cell"][data-column="hash"]')).toBeVisible();
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(1);

  // --- 2. cell selection -> editor populated, p95 <= 50ms -----------------------------------
  await page.click('[data-testid="page-size-100"]');
  // Same stale-render race as the page-size-10000 switch above, in the other direction: wait for
  // scrollHeight to actually settle into what a 100-row page produces before reading any cell —
  // a transient near-empty "reloading" state also satisfies a plain "< 10000" check, so the
  // window is bounded on both sides.
  await expect
    .poll(() => grid.evaluate((el) => el.scrollHeight > 500 && el.scrollHeight < 10_000), {
      timeout: 15_000,
    })
    .toBe(true);
  await grid.evaluate((el) => {
    el.scrollTop = 0;
  });

  // cell-editor-panel only mounts once a cell is selected (CellEditorDock.vue's own `v-if`, P26) —
  // the very first measured click would otherwise find no panel to observe yet. Warm up on a
  // different cell (row 0's "id" column) so every measured click below is a genuine transition.
  await page.click('[data-testid="grid-cell"][data-row="0"][data-column="id"]');
  await expect(page.locator('[data-testid="cell-editor-panel"]')).toBeVisible();

  // The grid only virtualizes as many rows as fit the viewport plus overscan (DataGrid.vue) — at
  // rest that's ~18 rows, not a flat 20, so read the rows actually rendered instead of assuming a
  // fixed count. §3's "20 cells" sample size is preserved by wrapping around the rendered set.
  const renderedRows: number[] = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="grid-row"]'))
      .map((el) => Number(el.getAttribute('data-row')))
      .filter((n) => Number.isInteger(n))
      .sort((a, b) => a - b),
  );
  if (renderedRows.length === 0) throw new Error('no grid rows rendered at scrollTop=0');

  const cellDeltas: number[] = [];
  for (let i = 0; i < 20; i++) {
    const row = renderedRows[i % renderedRows.length];
    const cellSelector = `[data-testid="grid-cell"][data-row="${row}"][data-column="hash"]`;
    const text = await page.locator(cellSelector).innerText();
    const delta = await measureClickToDom(page, {
      click: cellSelector,
      observe: '[data-testid="cell-editor-panel"]',
      until: { selector: '[data-testid="cell-editor-panel"] .cm-content', text },
    });
    cellDeltas.push(delta);
  }
  logStats('cell -> editor', cellDeltas);
  expect(percentile(cellDeltas, 95)).toBeLessThanOrEqual(50);

  // --- 3. cached tab switch, p95 <= 50ms -----------------------------------------------------
  await openRowMenu(page, WIDE_TABLE_PATH);
  await page.click('[data-testid="menu-item-open-data-new-tab"]');
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  await expect
    .poll(async () => page.locator('[data-testid="grid-gutter-cell"]').count(), { timeout: 15_000 })
    .toBeGreaterThan(0);
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(2);

  const bigRowsTabId = await page.locator('[data-testid="tab"]').nth(0).getAttribute('data-tab-id');
  const wideTableTabId = await page
    .locator('[data-testid="tab"]')
    .nth(1)
    .getAttribute('data-tab-id');
  if (!bigRowsTabId || !wideTableTabId) throw new Error('tab ids not found');

  // "Open data in new tab" leaves the new (wide_table) tab active, not big_rows — so the loop's
  // first click (toWide, i=0) would otherwise land on the tab that's already active and produce
  // no transition to measure. Start from a known state so every iteration is a genuine switch.
  await page.click(`[data-testid="tab"][data-tab-id="${bigRowsTabId}"]`);
  await expect(page.locator('[data-testid="grid-header-cell"][data-column="hash"]')).toBeVisible();

  const tabDeltas: number[] = [];
  for (let i = 0; i < 20; i++) {
    const toWide = i % 2 === 0;
    // MainView.vue mounts each tab's view with `:key="activeTab.id"` — switching tabs destroys
    // the previous [data-testid="data-grid"] element and mounts a brand new one, so a
    // MutationObserver attached to it (looked up before the click) would watch a node that's
    // about to be detached and never see the new grid's mutations. [data-testid="main-view"]
    // (WorkbenchShell.vue) wraps that swap and stays mounted across the switch.
    const delta = await measureClickToDom(page, {
      click: `[data-testid="tab"][data-tab-id="${toWide ? wideTableTabId : bigRowsTabId}"]`,
      observe: '[data-testid="main-view"]',
      until: {
        selector: toWide
          ? '[data-testid="grid-header-cell"][data-column="int_a"]'
          : '[data-testid="grid-header-cell"][data-column="hash"]',
      },
    });
    tabDeltas.push(delta);
  }
  logStats('cached tab switch', tabDeltas);
  expect(percentile(tabDeltas, 95)).toBeLessThanOrEqual(50);

  // --- 4. cached tree expand, p95 <= 50ms -----------------------------------------------------
  const expandDeltas: number[] = [];
  for (let i = 0; i < 20; i++) {
    const row = await findRow(page, APP_PATH);
    await row.locator('.twisty').click(); // collapse — not measured
    await expect(
      page.locator(`[data-testid="tree-row"][data-path="${BIG_ROWS_PATH}"]`),
    ).toHaveCount(0);
    const delta = await measureClickToDom(page, {
      click: `[data-testid="tree-row"][data-path="${APP_PATH}"] .twisty`,
      observe: '[data-testid="tree-background"] .virtual-list',
      until: { selector: `[data-testid="tree-row"][data-path="${BIG_ROWS_PATH}"]` },
    });
    expandDeltas.push(delta);
  }
  logStats('cached tree expand', expandDeltas);
  expect(percentile(expandDeltas, 95)).toBeLessThanOrEqual(50);

  // --- 5. console keystroke -> completion popup visible, p50 <= 50ms (P18 addendum D26) -------
  await openRowMenu(page, DB_PATH);
  await page.click('[data-testid="menu-item-open-console"]');
  const consoleView = page.locator('[data-testid="console-view"]');
  await expect(consoleView).toBeVisible();
  const tooltip = page.locator('.cm-tooltip-autocomplete');
  await consoleView.locator('.cm-content').click();
  await page.keyboard.type('SEL');
  await expect(tooltip).toBeVisible({ timeout: 5_000 });

  const keyDeltas: number[] = [];
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
    await page.keyboard.press('Backspace');
    keyDeltas.push(await measureKeyToPopup(page, 'l'));
  }
  logStats('console keystroke -> completion popup', keyDeltas);
  // This is the one assertion that would have caught D17's own starting point — F2's
  // `activateOnTypingDelay: 100` debounce — and the one that stops a future schema-aware source
  // from quietly reintroducing it.
  expect(percentile(keyDeltas, 50)).toBeLessThanOrEqual(50);
  expect(Math.max(...keyDeltas)).toBeLessThanOrEqual(200);

  expect(consoleErrors).toEqual([]);
});
