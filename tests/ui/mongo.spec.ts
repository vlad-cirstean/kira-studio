import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  type MongoFixture,
  startMongo,
} from './support/mongo';
import { expandRow, findRow, openRowMenu } from './support/tree';

// The third engine through the real UI (P8, mirrors mariadb.spec.ts's discipline for the
// second): document-shaped pages, not tabular grids, are the point of this spec — it proves
// DocumentView.vue's expand/edit/delete and the shell-style console work against a live server.
test.describe.configure({ timeout: 240_000 });

let mongo: MongoFixture | null = null;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  if (!(await isDockerAvailable())) {
    test.skip(true, DOCKER_UNAVAILABLE_MESSAGE);
    return;
  }
  mongo = await startMongo();
});

test.afterAll(async () => {
  await mongo?.stop();
});

const WIDGET_COUNT = 25;
const DB_PATH = 'database:kira_test';
const WIDGETS_PATH = `${DB_PATH}/collection:widgets`;

async function setDocumentFilter(page: Page, filter: string): Promise<void> {
  await page.fill('[data-testid="document-search"]', filter);
  await page.press('[data-testid="document-search"]', 'Enter');
}

async function connectMongo(page: Page): Promise<void> {
  if (!mongo) throw new Error('mongo fixture did not start');
  const cfg = mongo.config;
  await page.evaluate(
    (c) =>
      window.kira.connectionsCreate({
        name: 'Mongo',
        kind: 'mongodb',
        color: 'green',
        mode: 'fields',
        readOnly: false,
        host: c.host,
        port: c.port,
        database: c.database,
        username: c.username,
        password: c.password,
        uri: null,
        options: {},
        preconnect: null,
        preconnectSidecar: false,
      }),
    {
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      username: cfg.username,
      password: cfg.password,
    },
  );

  const connRow = page.locator('[data-testid="tree-row"][data-kind="connection"]');
  await expect(connRow).toBeVisible();
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });
}

test('mongodb — connect, tree, document tab, edit, delete, console, cancel', async ({
  kira,
  consoleErrors,
}) => {
  test.setTimeout(240_000);
  if (!mongo) throw new Error('mongo fixture did not start');
  const { window: page } = kira;
  page.on('dialog', (d) => d.accept());

  await connectMongo(page);

  // --- tree: database -> collection, no schema level in between -----------------------------
  // Collections are tree leaves — no twisty, no per-index children (their indexes moved into the
  // definition view's Indexes section; the 'index' NodeKind and its tree leaves are gone, matching
  // SQL tables, P19 D5/its own resolved open question 2).
  await expandRow(page, '');
  const dbRow = await expandRow(page, DB_PATH);
  await expect(dbRow).toHaveAttribute('data-kind', 'database');
  const widgetsRow = await findRow(page, WIDGETS_PATH);
  await expect(widgetsRow).toBeVisible();
  await expect(widgetsRow).toHaveAttribute('data-kind', 'collection');
  await expect(widgetsRow.locator('.twisty')).not.toBeVisible();

  await page.screenshot({ path: 'test-results/screenshots/mongo.png' });

  // --- open a document tab, verify it renders the document (not tabular) shape --------------
  await (await findRow(page, WIDGETS_PATH)).dblclick();
  const view = page.locator('[data-testid="document-view"]');
  await expect(view).toBeVisible();
  // DocumentView.vue passes a `path` breadcrumb prefix (connection / database /) alongside the
  // name into ViewHeader's shared `target-testid` span (same convention as KeyValueView.vue,
  // whose own target assertions in s3.spec.ts use toContainText for the same reason) — the full
  // text includes that prefix, not just the collection name.
  await expect(view.locator('[data-testid="document-target"]')).toContainText('widgets');
  await expect(page.locator('[data-testid="document-row"]')).toHaveCount(WIDGET_COUNT, {
    timeout: 15_000,
  });

  await page.click('[data-testid="document-count"]');
  // P16 removed the standalone status-line text (data-testid="document-status") — the exact
  // count now only surfaces indirectly, via pageCount driving the pager's "of N pages" label
  // (default page size 100 > 25 docs, so exactly one page) once the count resolves.
  await expect(page.locator('[data-testid="document-pager"]')).toContainText('of 1', {
    timeout: 15_000,
  });

  // --- filter narrows to a single document -----------------------------------------------
  await setDocumentFilter(page, "{ name: 'widget-1' }");
  await expect(page.locator('[data-testid="document-row"]')).toHaveCount(1, { timeout: 10_000 });

  // --- collapsed row shows only the _id, plus field-count/size badges — D1 ------------------
  const editRow = page.locator('[data-testid="document-row"]');
  await expect(editRow.locator('[data-testid="document-id"]')).toContainText('ObjectId(');
  await expect(editRow.locator('[data-testid="document-field-count"]')).toContainText('fields');
  await expect(editRow.locator('[data-testid="document-byte-badge"]')).toBeVisible();

  // --- edit: the row is already expanded by default (D2) — replace its body, save -----------
  await expect(editRow.locator('[data-testid="document-body"]')).toBeVisible();
  await expect(editRow.locator('[data-testid="document-tree"]')).toBeVisible();
  await editRow.locator('[data-testid="document-edit"]').click();
  const editCm = editRow.locator('[data-testid="document-body"] .cm-content');
  await editCm.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('{"name":"widget-1-edited","price":9,"active":true}');
  // D28: the row's own edit-action row carries the shared EditBufferActions — the modified chip
  // appears the moment the buffer diverges from what was seeded.
  await expect(editRow.locator('[data-testid="document-edit-modified"]')).toBeVisible();
  await editRow.locator('[data-testid="document-edit-save"]').click();

  // The still-applied "widget-1" filter no longer matches the renamed document — proves the
  // edit round-tripped through the real server (mutate.ts's replaceOne), not just local state.
  await expect(page.locator('[data-testid="document-row"]')).toHaveCount(0, { timeout: 10_000 });

  await setDocumentFilter(page, "{ name: 'widget-1-edited' }");
  const editedRow = page.locator('[data-testid="document-row"]');
  await expect(editedRow).toHaveCount(1, { timeout: 10_000 });
  // _id is preserved across a whole-document replace (mutate.ts overwrites `_id` from the
  // mutation's key), so this same row stays expanded and shows the new body automatically —
  // through DocumentTree.vue's flattened lines now, not a read-path CodeMirror (D19).
  await expect(editedRow.locator('[data-testid="document-tree"]')).toContainText('widget-1-edited');

  // --- delete: the row's own Delete button (D5/D6), native confirm dialog (auto-accepted) ----
  await setDocumentFilter(page, "{ name: 'widget-2' }");
  const deleteRow = page.locator('[data-testid="document-row"]');
  await expect(deleteRow).toHaveCount(1, { timeout: 10_000 });
  await expect(deleteRow.locator('[data-testid="document-delete"]')).toBeEnabled();
  await deleteRow.locator('[data-testid="document-delete"]').click();
  await expect(page.locator('[data-testid="document-row"]')).toHaveCount(0, { timeout: 10_000 });

  // --- delete via the context menu still works too (D7: the menu's shape is unchanged) ------
  await setDocumentFilter(page, "{ name: 'widget-3' }");
  const menuDeleteRow = page.locator('[data-testid="document-row"]');
  await expect(menuDeleteRow).toHaveCount(1, { timeout: 10_000 });
  await menuDeleteRow.click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await page.click('[data-testid="menu-item-delete-document"]');
  await expect(page.locator('[data-testid="document-row"]')).toHaveCount(0, { timeout: 10_000 });

  // --- clear the filter: 25 seeded - 2 deleted (the edited one is renamed, not gone) --------
  await setDocumentFilter(page, '');
  await expect(page.locator('[data-testid="document-row"]')).toHaveCount(WIDGET_COUNT - 2, {
    timeout: 10_000,
  });

  // --- cancel a slow read --------------------------------------------------------------------
  // Same $function busy-loop technique proven at the DB level (mongo.spec.ts) — evaluated once
  // per scanned document, so a full-collection scan takes far longer than the click below needs.
  const slowFilter =
    '{ $expr: { $function: { body: "function() { var s = new Date().getTime(); while (new Date().getTime() - s < 3000) {} return true; }", args: [], lang: \'js\' } } }';
  await setDocumentFilter(page, slowFilter);
  await expect(page.locator('[data-testid="document-stop"]')).toBeVisible({ timeout: 5_000 });
  await page.click('[data-testid="document-stop"]');
  await expect
    .poll(
      async () => {
        const ops = await page.evaluate(() => window.kira.opsRecent({ limit: 200 }));
        return ops.find((o) => o.kind === 'read')?.status;
      },
      { timeout: 10_000 },
    )
    .toBe('cancelled');
  await setDocumentFilter(page, '');
  await expect(page.locator('[data-testid="document-row"]')).toHaveCount(WIDGET_COUNT - 2, {
    timeout: 10_000,
  });

  // --- console: shell-style statement against the same collection ---------------------------
  await openRowMenu(page, WIDGETS_PATH);
  await page.click('[data-testid="menu-item-open-console"]');
  const consoleView = page.locator('[data-testid="console-view"]');
  await expect(consoleView).toBeVisible();
  await expect(consoleView.locator('[data-testid="console-target"]')).toHaveText('widgets');
  await consoleView.locator('.cm-content').click();
  await page.keyboard.type('db.widgets.countDocuments({})');
  await page.click('[data-testid="console-run-statement"]');
  const consoleResult = consoleView.locator('[data-testid="console-result-grid"]');
  await expect(consoleResult).toHaveCount(1);
  await expect(consoleResult.locator('[data-testid="console-result-doc-row"]')).toContainText(
    String(WIDGET_COUNT - 2),
  );

  expect(consoleErrors).toEqual([]);
});

test('mongodb — page-size-1000 render tripwires, truncated fallback, go-to-match (P27 D8/D22/D24)', async ({
  kira,
  consoleErrors,
}) => {
  test.setTimeout(240_000);
  if (!mongo) throw new Error('mongo fixture did not start');
  const { window: page } = kira;
  page.on('dialog', (d) => d.accept());

  await connectMongo(page);
  await expandRow(page, '');
  await expandRow(page, DB_PATH);

  // --- perf tripwires at page size 1000 (D24): bounded DOM row count, no per-row CodeMirror --
  const bigPath = `${DB_PATH}/collection:big_widgets`;
  await (await findRow(page, bigPath)).dblclick();
  const view = page.locator('[data-testid="document-view"]');
  await expect(view).toBeVisible();
  await expect(page.locator('[data-testid="document-row"]')).toHaveCount(100, { timeout: 15_000 });
  await page.click('[data-testid="document-page-size-1000"]');
  await expect
    .poll(async () => page.locator('[data-testid="document-row"]').count(), { timeout: 15_000 })
    .toBeGreaterThan(0);
  const rowCount = await page.locator('[data-testid="document-row"]').count();
  expect(rowCount).toBeLessThanOrEqual(60);
  // Every row's body renders through DocumentTree.vue while it's expanded (the default, D2) —
  // never a per-row editor — so no CodeMirror instance exists anywhere in the list (D19/D24).
  await expect(page.locator('[data-testid="document-list"] .cm-editor')).toHaveCount(0);

  // --- go to match scrolls a document that starts off-screen into view (D8) ------------------
  await page.click('[data-testid="document-toolbar-search"]');
  await page.fill('[data-testid="document-search-input"]', 'big-widget-999');
  await page.press('[data-testid="document-search-input"]', 'Enter');
  await expect(page.locator('[data-testid="document-search-count"]')).toContainText('1', {
    timeout: 10_000,
  });
  await page.click('[data-testid="document-search-next"]');
  await expect(
    page.locator('[data-testid="document-row"]', { hasText: 'big-widget-999' }),
  ).toBeVisible({ timeout: 10_000 });
  await page.click('[data-testid="document-search-close"]');

  // --- expand all / collapse all still work on a large page (D32) ----------------------------
  await page.click('[data-testid="document-collapse-all"]');
  await expect(page.locator('[data-testid="document-tree"]')).toHaveCount(0);
  await page.click('[data-testid="document-expand-all"]');
  await expect(page.locator('[data-testid="document-tree"]').first()).toBeVisible({
    timeout: 10_000,
  });

  // --- a truncated document falls back to raw text, not an empty tree (D22) ------------------
  const oversizedPath = `${DB_PATH}/collection:oversized_widgets`;
  await (await findRow(page, oversizedPath)).dblclick();
  await expect(page.locator('[data-testid="document-view"]')).toBeVisible();
  const truncRow = page.locator('[data-testid="document-row"]');
  await expect(truncRow).toHaveCount(1, { timeout: 15_000 });
  await expect(truncRow.locator('[data-testid="document-truncated"]')).toBeVisible();
  await expect(truncRow.locator('[data-testid="document-tree"]')).toHaveCount(0);
  await expect(truncRow.locator('[data-testid="document-body"] .cm-editor')).toBeVisible();

  expect(consoleErrors).toEqual([]);
});
