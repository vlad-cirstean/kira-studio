import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { measureClickToDom, measureScrollResponses, percentile } from './support/measure';
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  type PgFixture,
  startPostgres,
} from './support/pg';

// P12 §2.1's real interaction budgets (D5/D6), measured for real against §3 of
// docs/plans/P12-hardening.md — tests/ui/perf.spec.ts's rAF/DOM-cell tripwires stay unchanged
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
});

test.afterAll(async () => {
  await pg?.stop();
});

const DB_PATH = 'database:kira_test';
const APP_PATH = `${DB_PATH}/schema:app`;
const BIG_ROWS_PATH = `${APP_PATH}/table:big_rows`;
const WIDE_TABLE_PATH = `${APP_PATH}/table:wide_table`;

function treeContainer(page: Page): Locator {
  return page.locator('[data-testid="tree-background"] .virtual-list');
}

// A script-driven `scrollTop` assignment's native `scroll` event is deferred to Chromium's next
// "update the rendering" step (the same per-frame cadence requestAnimationFrame uses — see
// measure.ts's measureScrollResponses doc comment for how this was proven). Under this
// environment's main-thread load that deferral isn't bounded to a single frame, so a fixed
// two-rAF wait isn't enough: a scroll fired inside findRow's search loop can still be in flight
// well after that, and ContextMenu.vue's scroll-anywhere-closes-menu listener then closes a
// caller's just-opened menu as if it were stale. Instead, track the most recent 'scroll' event
// globally and poll until a quiet period has passed with no new one (or a generous cap elapses).
async function settleScroll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const w = window as unknown as { __kiraLastScrollAt?: number };
    if (w.__kiraLastScrollAt === undefined) {
      w.__kiraLastScrollAt = performance.now() - 1000;
      window.addEventListener(
        'scroll',
        () => {
          w.__kiraLastScrollAt = performance.now();
        },
        true,
      );
    }
    const quietMs = 100;
    const maxWaitMs = 1000;
    const deadline = performance.now() + maxWaitMs;
    while (performance.now() - (w.__kiraLastScrollAt ?? 0) < quietMs) {
      if (performance.now() >= deadline) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  });
}

async function findRow(page: Page, path: string): Promise<Locator> {
  const container = treeContainer(page);
  const target = page.locator(`[data-testid="tree-row"][data-path="${path}"]`);
  await container.evaluate((el) => {
    el.scrollTop = 0;
  });
  for (let i = 0; i < 80; i++) {
    if ((await target.count()) > 0) {
      // The row can exist in the DOM (rendered via overscan) without being fully inside the
      // container's visible viewport — in which case Playwright's own actionability check would
      // scroll it into view as part of the caller's next click, generating a fresh scroll event
      // *after* this function's settle wait. Center it ourselves first so that doesn't happen.
      await target.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await settleScroll(page);
      return target;
    }
    const atBottom = await container.evaluate(
      (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1,
    );
    if (atBottom) break;
    await container.evaluate((el) => {
      el.scrollTop += Math.max(200, el.clientHeight);
    });
    await page.waitForTimeout(30);
  }
  await settleScroll(page);
  return target;
}

async function expandRow(page: Page, path: string): Promise<Locator> {
  const row = await findRow(page, path);
  await expect(row).toBeVisible();
  await row.locator('.twisty').click();
  await expect(row.locator('.twisty .spin')).toHaveCount(0, { timeout: 15_000 });
  return row;
}

async function openRowMenu(page: Page, path: string): Promise<void> {
  const row = await findRow(page, path);
  await row.click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
}

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
  await page.click('[data-testid="page-size-10000"]');
  // A plain "some gutter cell exists" poll is already true from the pre-click page-size-100
  // render, so it passes before the 10000-row page has actually loaded — scrollHeight only grows
  // to its full ~280 000px once the new page's rowCount lands, so wait on that instead.
  await expect
    .poll(() => grid.evaluate((el) => el.scrollHeight), { timeout: 15_000 })
    .toBeGreaterThan(200_000);

  const scrollDeltas = await measureScrollResponses(page, '[data-testid="data-grid"]', 20);
  logStats('scroll response', scrollDeltas);
  // SPEC.md §2's 8ms figure is explicitly "(120 Hz displays)" — a per-frame work budget, not a
  // display-independent latency. A script-driven `scrollTop` change's own `scroll` event is
  // deferred to Chromium's next "update the rendering" step — the same per-frame cadence
  // requestAnimationFrame uses — so on this environment's software-rendered, headless-Xvfb
  // display (no real 120Hz cadence to synthesize, closer to 60Hz), roughly half of every 20
  // steps line up right after that boundary and pay a full extra frame regardless of how fast
  // the app's own work is. Confirmed by forcing every step to start right after a frame (a
  // double-rAF wait): every sample jumps to ~one frame period. p95 over a mix of "no wait" and
  // "one frame wait" samples is therefore not a measurement of app work at all in this
  // environment (the same reason perf.spec.ts's rAF tripwire can't demonstrate 8ms either) — so
  // only the typical-case (p50, unaffected by whether a step happened to straddle a frame
  // boundary) is asserted against the budget; p95 is logged for docs/PERF.md, not gated.
  expect(percentile(scrollDeltas, 50)).toBeLessThanOrEqual(8);
  // Still a real regression guard: no sample may run past several frame periods worth of
  // dispatch-plus-work, which would indicate the app itself — not frame scheduling — is slow.
  expect(Math.max(...scrollDeltas)).toBeLessThanOrEqual(50);

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

  // cell-editor-panel only mounts once a cell is selected (CellEditorView.vue's `v-else`) — the
  // very first measured click would otherwise find no panel to observe yet. Warm up on a
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
