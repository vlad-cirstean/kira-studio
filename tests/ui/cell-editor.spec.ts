import type { Locator, Page } from '@playwright/test';
import type { ConnectionColor } from '@shared/domain/connection';
import { expect, test } from './fixtures';
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  type PgFixture,
  startPostgres,
} from './support/pg';

test.describe.configure({ timeout: 300_000 });

let pg: PgFixture | null = null;

test.beforeAll(async () => {
  test.setTimeout(300_000);
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
const FORMATS_PATH = `${APP_PATH}/table:formats`;
const WIDE_PATH = `${APP_PATH}/table:wide_table`;
const NULLS_PATH = `${APP_PATH}/table:nulls_and_unicode`;
const NESTED_PATH = `${APP_PATH}/table:nested_json`;

interface OpRecordLike {
  id: string;
  connectionId: string | null;
  kind: string;
}

function treeContainer(page: Page): Locator {
  return page.locator('[data-testid="tree-background"] .virtual-list');
}

async function findRow(page: Page, path: string): Promise<Locator> {
  const container = treeContainer(page);
  const target = page.locator(`[data-testid="tree-row"][data-path="${path}"]`);
  await container.evaluate((el) => {
    el.scrollTop = 0;
  });
  for (let i = 0; i < 80; i++) {
    if ((await target.count()) > 0) return target;
    const atBottom = await container.evaluate(
      (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1,
    );
    if (atBottom) break;
    await container.evaluate((el) => {
      el.scrollTop += Math.max(200, el.clientHeight);
    });
    await page.waitForTimeout(30);
  }
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

async function getOps(page: Page, connectionId: string): Promise<OpRecordLike[]> {
  const all = await page.evaluate(() => window.kira.opsRecent({ limit: 5000 }));
  return all.filter((o) => o.connectionId === connectionId);
}

async function cellText(page: Page, row: number, column: string): Promise<string> {
  return (
    await page.locator(`[data-testid="grid-cell"][data-row="${row}"][data-column="${column}"]`)
  ).innerText();
}

async function selectCell(page: Page, row: number, column: string): Promise<void> {
  await page
    .locator(`[data-testid="grid-cell"][data-row="${row}"][data-column="${column}"]`)
    .click();
}

// The data grid virtualizes columns the same way the tree virtualizes rows (DataGrid.vue's
// visibleColumnIndices) — a column not currently scrolled into view simply has no DOM node, so a
// wide_table column past the first screenful must be scrolled into view before it can be
// selected or asserted on.
async function scrollColumnIntoView(page: Page, column: string): Promise<void> {
  const grid = page.locator('[data-testid="data-grid"]');
  const target = page.locator(`[data-testid="grid-header-cell"][data-column="${column}"]`);
  if ((await target.count()) > 0) return;
  await grid.evaluate((el) => {
    el.scrollLeft = 0;
  });
  // Setting scrollLeft programmatically dispatches the 'scroll' event asynchronously — without
  // this wait, the loop's first check below races ahead of Vue's re-render and wrongly concludes
  // the reset didn't bring the target into view, so it scrolls right and never returns to 0.
  await page.waitForTimeout(50);
  for (let i = 0; i < 80; i++) {
    if ((await target.count()) > 0) return;
    const atEnd = await grid.evaluate((el) => el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
    if (atEnd) break;
    await grid.evaluate((el) => {
      el.scrollLeft += Math.max(200, el.clientWidth);
    });
    await page.waitForTimeout(30);
  }
}

async function editorText(page: Page): Promise<string> {
  return page.locator('[data-testid="cell-editor-panel"] .cm-content').innerText();
}

async function createConnection(
  page: Page,
  cfg: {
    host: string | null;
    port: number | null;
    database: string | null;
    username: string | null;
    password: string | null;
  },
  opts: { name: string; color: ConnectionColor; readOnly: boolean },
): Promise<string> {
  return page.evaluate(
    ({ cfg, opts }) =>
      window.kira
        .connectionsCreate({
          name: opts.name,
          kind: 'postgres',
          color: opts.color,
          mode: 'fields',
          readOnly: opts.readOnly,
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
    { cfg, opts },
  );
}

async function kindOf(page: Page, row: number): Promise<string> {
  return cellText(page, row, 'kind');
}

/** `json-invalid` is the only fixture kind whose expected detection differs from its own name. */
function expectedFormatFor(kind: string): string {
  return kind === 'json-invalid' ? 'json' : kind;
}

test('cell editor — autodetect, beautify, override, NULL/empty/truncated, read-only', async ({
  kira,
  relaunch,
  consoleErrors,
}) => {
  test.setTimeout(300_000);
  if (!pg) throw new Error('postgres fixture did not start');
  const { window: page } = kira;

  // Zero-operations invariant (§0): the cell editor issues no DB ops of its own.
  const cfg = {
    host: pg.config.host,
    port: pg.config.port,
    database: pg.config.database,
    username: pg.config.username,
    password: pg.config.password,
  };
  const connectionId = await createConnection(page, cfg, {
    name: 'Cell Editor DB',
    color: 'green',
    readOnly: false,
  });

  const connRow = page.locator('[data-testid="tree-row"][data-kind="connection"]');
  await expect(connRow).toBeVisible();
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });
  await expandRow(page, '');
  await expandRow(page, DB_PATH);
  await expandRow(page, APP_PATH);

  const formatsRow = await findRow(page, FORMATS_PATH);
  await formatsRow.dblclick();
  const grid = page.locator('[data-testid="data-grid"]');
  await expect(grid).toBeVisible();
  await expect(
    page.locator('[data-testid="grid-header-cell"][data-column="sample"]'),
  ).toBeVisible();
  const panel = page.locator('[data-testid="cell-editor-panel"]');

  // --- scenario 1: populate --------------------------------------------------------------
  await selectCell(page, 0, 'sample');
  await panel.waitFor();
  const tabId = (await panel.getAttribute('data-cell-key'))?.split(':')[0] ?? '';
  expect(tabId).not.toBe('');
  await expect(panel).toHaveAttribute('data-cell-key', `${tabId}:0:sample`);
  await expect(panel).toHaveAttribute('data-detected', expectedFormatFor(await kindOf(page, 0)));
  await expect(page.locator('[data-testid="cell-editor-target"]')).toContainText('formats.sample');
  await expect(page.locator('[data-testid="cell-editor-target"]')).toContainText('row 1');
  expect(await editorText(page)).toBe(await cellText(page, 0, 'sample'));

  // --- scenario 2: every format, read out of the fixture's own `kind` column -------------
  for (let row = 0; row < 13; row++) {
    const kind = await kindOf(page, row);
    await selectCell(page, row, 'sample');
    await expect(panel).toHaveAttribute('data-cell-key', `${tabId}:${row}:sample`);
    await expect(panel, `row ${row} (kind=${kind})`).toHaveAttribute(
      'data-detected',
      expectedFormatFor(kind),
    );
  }

  // --- scenario 3: type-driven detection --------------------------------------------------
  const nestedRow = await findRow(page, NESTED_PATH);
  await nestedRow.dblclick();
  await expect(page.locator('[data-testid="grid-header-cell"][data-column="data"]')).toBeVisible();
  await selectCell(page, 0, 'data');
  await expect(panel).toHaveAttribute('data-detected', 'json');

  const wideRow = await findRow(page, WIDE_PATH);
  await wideRow.dblclick();
  await scrollColumnIntoView(page, 'uuid_a');
  await expect(
    page.locator('[data-testid="grid-header-cell"][data-column="uuid_a"]'),
  ).toBeVisible();
  await selectCell(page, 0, 'uuid_a');
  await expect(panel).toHaveAttribute('data-detected', 'uuid');
  await scrollColumnIntoView(page, 'ts_a');
  await selectCell(page, 0, 'ts_a');
  await expect(panel).toHaveAttribute('data-detected', 'iso8601');
  await scrollColumnIntoView(page, 'bytea_a');
  await selectCell(page, 0, 'bytea_a');
  await expect(panel).toHaveAttribute('data-detected', 'hex');
  await expect(page.locator('[data-testid="cell-editor-status"]')).toContainText('bytes');
  await scrollColumnIntoView(page, 'int_a');
  await selectCell(page, 0, 'int_a');
  await expect(panel).toHaveAttribute('data-detected', 'text');

  // --- back to formats (reactivates the original tab: same connectionId+path, D-tabs) ------
  await formatsRow.dblclick();
  await expect(
    page.locator('[data-testid="grid-header-cell"][data-column="sample"]'),
  ).toBeVisible();
  await expect(page.locator(`[data-testid="tab"][data-tab-id="${tabId}"]`)).toHaveAttribute(
    'data-active',
    'true',
  );

  // --- scenario 4: beautify ---------------------------------------------------------------
  const jsonRow = 0; // formats row 0 is the 'json' sample (fixture insertion order)
  expect(await kindOf(page, jsonRow)).toBe('json');
  await selectCell(page, jsonRow, 'sample');
  await expect(panel).toHaveAttribute('data-detected', 'json');
  const storedJson = await cellText(page, jsonRow, 'sample');

  await page.click('[data-testid="cell-editor-beautify-indented"]');
  await expect(panel).toHaveAttribute('data-formatted', 'indented');
  expect((await editorText(page)).split('\n').length).toBeGreaterThan(1);
  await expect(page.locator('[data-testid="cell-editor-beautify-reset"]')).toBeEnabled();

  await page.click('[data-testid="cell-editor-beautify-compact"]');
  await expect(panel).toHaveAttribute('data-formatted', 'compact');
  expect((await editorText(page)).split('\n').length).toBe(1);

  await page.click('[data-testid="cell-editor-beautify-reset"]');
  await expect(panel).toHaveAttribute('data-formatted', 'none');
  expect(await editorText(page)).toBe(storedJson);
  await expect(page.locator('[data-testid="cell-editor-beautify-reset"]')).toBeDisabled();

  // The 'text' row has no lossless formatter: both buttons disabled.
  let textRowIndex = -1;
  for (let row = 0; row < 13; row++) {
    if ((await kindOf(page, row)) === 'text') {
      textRowIndex = row;
      break;
    }
  }
  expect(textRowIndex).toBeGreaterThanOrEqual(0);
  await selectCell(page, textRowIndex, 'sample');
  await expect(page.locator('[data-testid="cell-editor-beautify-indented"]')).toBeDisabled();
  await expect(page.locator('[data-testid="cell-editor-beautify-compact"]')).toBeDisabled();

  // --- scenario 5: lossless numbers --------------------------------------------------------
  await selectCell(page, jsonRow, 'sample');
  await page.click('[data-testid="cell-editor-beautify-indented"]');
  expect(await editorText(page)).toContain('12345678901234567890');
  await page.click('[data-testid="cell-editor-beautify-compact"]');
  expect(await editorText(page)).toContain('12345678901234567890');
  await page.click('[data-testid="cell-editor-beautify-reset"]');

  // --- scenario 6: manual override sticks per column, for the session --------------------
  await selectCell(page, jsonRow, 'sample');
  await page.selectOption('[data-testid="cell-editor-format"]', 'text');
  await expect(panel).toHaveAttribute('data-format', 'text');

  for (const row of [1, 2]) {
    await selectCell(page, row, 'sample');
    await expect(panel).toHaveAttribute('data-format', 'text');
    await expect(panel).toHaveAttribute(
      'data-detected',
      expectedFormatFor(await kindOf(page, row)),
    );
  }

  await openRowMenu(page, FORMATS_PATH);
  await page.click('[data-testid="menu-item-open-data-new-tab"]');
  await expect(
    page.locator('[data-testid="grid-header-cell"][data-column="sample"]'),
  ).toBeVisible();
  const secondTabId = (await page
    .locator('[data-testid="tab"][data-active="true"]')
    .getAttribute('data-tab-id')) as string;
  expect(secondTabId).not.toBe(tabId);

  await selectCell(page, jsonRow, 'sample');
  await expect(panel).toHaveAttribute('data-format', 'text'); // sticks across tabs, same (conn, path, column)

  // A different column on the same row is unaffected by the override: its format still tracks
  // its own auto-detection rather than the 'sample' column's override. Asserting format equals
  // detected (rather than merely "not text") is load-bearing — 'kind' holds a plain word like
  // "json" that itself auto-detects as 'text', so a leaked override would be indistinguishable
  // from correct behavior under a bare `not.toHaveAttribute('data-format', 'text')` check.
  await selectCell(page, jsonRow, 'kind');
  const [kindFormat, kindDetected] = await Promise.all([
    panel.getAttribute('data-format'),
    panel.getAttribute('data-detected'),
  ]);
  expect(kindFormat).toBe(kindDetected);

  await selectCell(page, jsonRow, 'sample');
  await page.selectOption('[data-testid="cell-editor-format"]', 'auto');
  await expect(panel).toHaveAttribute('data-format', 'json');

  // --- scenario 7: NULL, empty, truncated -------------------------------------------------
  const nullsRow = await findRow(page, NULLS_PATH);
  await nullsRow.dblclick();
  await expect(page.locator('[data-testid="grid-header-cell"][data-column="label"]')).toBeVisible();

  await selectCell(page, 0, 'label');
  await expect(page.locator('[data-testid="cell-editor-badge-null"]')).toBeVisible();
  await expect(page.locator('[data-testid="cell-editor-format"]')).toBeDisabled();

  await selectCell(page, 1, 'label');
  await expect(page.locator('[data-testid="cell-editor-badge-empty"]')).toBeVisible();

  await scrollColumnIntoView(page, 'big_text');
  await selectCell(page, 3, 'big_text');
  await expect(page.locator('[data-testid="cell-editor-badge-truncated"]')).toBeVisible();
  await expect(page.locator('[data-testid="cell-editor-status"]')).toContainText('64 KB');

  // Captured here, not at the very top: scenarios 1-7 legitimately open several new tables
  // (nested_json, wide_table, nulls_and_unicode), each a genuine read — the zero-ops invariant
  // below is about the cell editor's OWN interactions (selection, beautify, override), exercised
  // from here on with no further table opens on this connection.
  const opsBaseline = (await getOps(page, connectionId)).length;

  // --- scenario 8: selection semantics -----------------------------------------------------
  // Switch back to the original formats tab explicitly (by id) rather than dblclick, since two
  // tabs on (connection, FORMATS_PATH) exist after scenario 6 and dblclick would activate
  // whichever the tree menu resolves to first — the tab strip is unambiguous.
  await page.locator(`[data-testid="tab"][data-tab-id="${tabId}"]`).click();
  await expect(
    page.locator('[data-testid="grid-header-cell"][data-column="sample"]'),
  ).toBeVisible();

  await selectCell(page, 0, 'sample');
  await panel.waitFor();
  await page.locator('[data-testid="grid-cell"][data-row="2"][data-column="sample"]').click({
    modifiers: ['Shift'],
  });
  await expect(panel).toHaveAttribute('data-cell-key', `${tabId}:2:sample`);

  // A row selection carries no single cell to show — the panel now auto-hides entirely rather
  // than staying mounted with a "no cell selected" placeholder (no more manual toggle to have
  // pinned it open).
  await page.locator('[data-testid="grid-gutter-cell"]').first().click();
  await expect(page.locator('[data-testid="cell-editor"]')).toBeHidden();

  await selectCell(page, 0, 'sample');
  await panel.waitFor();
  // The header's column-select trigger is a narrow strip at the header cell's left edge
  // (DataGrid.vue's `.header-select-zone`) — distinct from the sort target (the label/chevron,
  // covering the rest of the cell).
  await page
    .locator('[data-testid="grid-header-cell"][data-column="kind"] .header-select-zone')
    .click();
  await expect(page.locator('[data-testid="cell-editor"]')).toBeHidden();

  // --- scenario 9: an editable cell is genuinely editable, and blurring the editor auto-stages
  // into the SAME pending-change set the grid's own inline (double-click) edit and the toolbar's
  // Commit/Discard already operate on (P5's stage/preview/commit model — nothing here writes to
  // the server directly). `formats` has a primary key and this connection is writable, so this
  // cell carries no read-only-reason at all. There is no separate Save button — leaving the
  // editor (or Ctrl+Enter, without needing to leave it) is the stage signal, mirroring
  // DataGrid.vue's own inline double-click edit, which stages on blur too.
  await selectCell(page, 0, 'sample');
  await panel.waitFor();
  await expect(panel).not.toHaveAttribute('data-read-only-reason');
  await expect(page.locator('[data-testid="cell-editor-save"]')).toHaveCount(0);

  const beforeType = await editorText(page);
  await page.locator('[data-testid="cell-editor-panel"] .cm-content').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('"edited from the cell editor"');
  expect(await editorText(page)).not.toBe(beforeType);

  // Blur by moving focus to the format select, still inside the panel but outside the editor.
  await page.locator('[data-testid="cell-editor-format"]').focus();
  await expect(
    page.locator('[data-testid="grid-cell"][data-row="0"][data-column="sample"]'),
  ).toHaveClass(/pending-edit/);
  expect(await cellText(page, 0, 'sample')).toBe('"edited from the cell editor"');

  // Discard before moving on: scenario 10 below asserts zero DB operations for everything the
  // cell editor itself did, and a lingering pending edit has no business surviving into the
  // read-only-connection scenario that follows.
  await page.click('[data-testid="toolbar-discard-changes"]');
  await expect(
    page.locator('[data-testid="grid-cell"][data-row="0"][data-column="sample"]'),
  ).not.toHaveClass(/pending-edit/);

  // Ctrl+Enter stages immediately, without needing to blur.
  await page.locator('[data-testid="cell-editor-panel"] .cm-content').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('"edited via ctrl-enter"');
  await page.keyboard.press('Control+Enter');
  await expect(
    page.locator('[data-testid="grid-cell"][data-row="0"][data-column="sample"]'),
  ).toHaveClass(/pending-edit/);
  expect(await cellText(page, 0, 'sample')).toBe('"edited via ctrl-enter"');
  await page.click('[data-testid="toolbar-discard-changes"]');

  // Collapse connection 1's root before creating connection 2 — every descendant row (database,
  // schema, table) shares the exact same `data-path` values connection 2 will render, and
  // findRow()/expandRow() match on `data-path` alone with no per-connection scoping (mirrors
  // tabs.spec.ts's session-restore scenario, which hits the identical ambiguity).
  const firstConnRow = page.locator('[data-testid="tree-row"][data-kind="connection"]');
  await expect(firstConnRow).toHaveCount(1);
  await firstConnRow.locator('.twisty').click();

  await createConnection(page, cfg, { name: 'Cell Editor DB (RO)', color: 'red', readOnly: true });
  const roConnRow = page
    .locator('[data-testid="tree-row"][data-kind="connection"]')
    .filter({ hasText: 'Cell Editor DB (RO)' });
  await expect(roConnRow).toBeVisible();
  await roConnRow.click({ button: 'right' });
  await page.click('[data-testid="menu-item-connect"]');
  await expect(roConnRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });
  await roConnRow.locator('.twisty').click();
  await expandRow(page, DB_PATH);
  await expandRow(page, APP_PATH);
  const roFormatsRow = await findRow(page, FORMATS_PATH);
  await roFormatsRow.dblclick();
  await expect(
    page.locator('[data-testid="grid-header-cell"][data-column="sample"]'),
  ).toBeVisible();
  await selectCell(page, 0, 'sample');
  await panel.waitFor();
  await expect(panel).toHaveAttribute('data-read-only-reason', 'connection-read-only');

  // Back to the original (writable) tab for the remaining scenarios.
  await page.locator(`[data-testid="tab"][data-tab-id="${tabId}"]`).click();
  await expect(
    page.locator('[data-testid="grid-header-cell"][data-column="sample"]'),
  ).toBeVisible();

  // --- scenario 10: zero operations ---------------------------------------------------------
  const opsAfter = (await getOps(page, connectionId)).length;
  expect(opsAfter).toBe(opsBaseline);

  // --- scenario 11: populate latency tripwire ------------------------------------------------
  // Deliberately far looser than §2.1's 50 ms budget: Playwright drives an instrumented,
  // unoptimised build, so this catches "someone re-creates the EditorView per cell", not the
  // budget itself — the real measurement is P12's.
  const t0 = Date.now();
  await selectCell(page, 3, 'sample');
  await expect
    .poll(async () => (await panel.getAttribute('data-cell-key')) ?? '')
    .toBe(`${tabId}:3:sample`);
  const elapsed = Date.now() - t0;
  console.log(`cell-editor populate latency: ${elapsed}ms`);
  expect(elapsed).toBeLessThan(250);

  await page.screenshot({ path: 'test-results/screenshots/cell-editor.png' });

  // --- scenario 12: visibility follows selection — no manual toggle exists anymore ------------
  await page.locator('[data-testid="grid-gutter-cell"]').first().click();
  await expect(page.locator('[data-testid="cell-editor"]')).toBeHidden();
  await selectCell(page, 3, 'sample');
  await expect(page.locator('[data-testid="cell-editor"]')).toBeVisible();
  await expect(panel).toHaveAttribute('data-cell-key', `${tabId}:3:sample`);

  await page.waitForTimeout(300); // layout.ts's 150ms write-debounce, so relaunch sees any layout writes
  const relaunched = await relaunch();
  await relaunched.window.waitForSelector('[data-testid="status-bar"]');
  // Cell selection is session-only and never persisted (D3/D12) — a fresh window starts with
  // nothing selected, so the panel starts hidden until the user clicks a cell again.
  await expect(relaunched.window.locator('[data-testid="cell-editor"]')).toBeHidden();

  expect(consoleErrors).toEqual([]);
});
