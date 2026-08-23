import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  type MongoFixture,
  startMongo,
} from './support/mongo';

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
const WIDGETS_ID_INDEX_PATH = `${WIDGETS_PATH}/index:_id_`;

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

async function setDocumentFilter(page: Page, filter: string): Promise<void> {
  await page.fill('[data-testid="document-search"]', filter);
  await page.press('[data-testid="document-search"]', 'Enter');
}

test('mongodb — connect, tree, document tab, edit, delete, console, cancel', async ({
  kira,
  consoleErrors,
}) => {
  test.setTimeout(240_000);
  if (!mongo) throw new Error('mongo fixture did not start');
  const { window: page } = kira;
  page.on('dialog', (d) => d.accept());

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

  // --- tree: database -> collection -> indexes, no schema level in between ------------------
  await expandRow(page, '');
  const dbRow = await expandRow(page, DB_PATH);
  await expect(dbRow).toHaveAttribute('data-kind', 'database');
  const widgetsRow = await expandRow(page, WIDGETS_PATH);
  await expect(widgetsRow).toHaveAttribute('data-kind', 'collection');
  const idIndexRow = await findRow(page, WIDGETS_ID_INDEX_PATH);
  await expect(idIndexRow).toBeVisible();
  await expect(idIndexRow).toHaveAttribute('data-kind', 'index');

  await page.screenshot({ path: 'test-results/screenshots/mongo.png' });

  // --- open a document tab, verify it renders the document (not tabular) shape --------------
  await (await findRow(page, WIDGETS_PATH)).dblclick();
  const view = page.locator('[data-testid="document-view"]');
  await expect(view).toBeVisible();
  await expect(view.locator('[data-testid="document-target"]')).toHaveText('widgets');
  await expect(page.locator('[data-testid="document-row"]')).toHaveCount(WIDGET_COUNT, {
    timeout: 15_000,
  });

  await page.click('[data-testid="document-count"]');
  await expect(page.locator('[data-testid="document-status"]')).toContainText('25 total', {
    timeout: 15_000,
  });

  // --- filter narrows to a single document -----------------------------------------------
  await setDocumentFilter(page, "{ name: 'widget-1' }");
  await expect(page.locator('[data-testid="document-row"]')).toHaveCount(1, { timeout: 10_000 });

  // --- edit: expand the row, replace its body, save ----------------------------------------
  const editRow = page.locator('[data-testid="document-row"]');
  await editRow.locator('[data-testid="document-toggle-expand"]').click();
  await expect(editRow.locator('[data-testid="document-body"]')).toBeVisible();
  await editRow.locator('[data-testid="document-edit"]').click();
  const editCm = editRow.locator('[data-testid="document-body"] .cm-content');
  await editCm.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('{"name":"widget-1-edited","price":9,"active":true}');
  await editRow.locator('[data-testid="document-edit-save"]').click();

  // The still-applied "widget-1" filter no longer matches the renamed document — proves the
  // edit round-tripped through the real server (mutate.ts's replaceOne), not just local state.
  await expect(page.locator('[data-testid="document-row"]')).toHaveCount(0, { timeout: 10_000 });

  await setDocumentFilter(page, "{ name: 'widget-1-edited' }");
  const editedRow = page.locator('[data-testid="document-row"]');
  await expect(editedRow).toHaveCount(1, { timeout: 10_000 });
  // _id is preserved across a whole-document replace (mutate.ts overwrites `_id` from the
  // mutation's key), so this same row stays expanded and shows the new body automatically.
  await expect(editedRow.locator('[data-testid="document-body"] .cm-content')).toContainText(
    'widget-1-edited',
  );

  // --- delete: context menu, native confirm dialog (auto-accepted above) --------------------
  await setDocumentFilter(page, "{ name: 'widget-2' }");
  const deleteRow = page.locator('[data-testid="document-row"]');
  await expect(deleteRow).toHaveCount(1, { timeout: 10_000 });
  await deleteRow.click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await page.click('[data-testid="menu-item-delete-document"]');
  await expect(page.locator('[data-testid="document-row"]')).toHaveCount(0, { timeout: 10_000 });

  // --- clear the filter: 25 seeded - 1 deleted (the edited one is renamed, not gone) --------
  await setDocumentFilter(page, '');
  await expect(page.locator('[data-testid="document-row"]')).toHaveCount(WIDGET_COUNT - 1, {
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
  await expect(page.locator('[data-testid="document-row"]')).toHaveCount(WIDGET_COUNT - 1, {
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
    String(WIDGET_COUNT - 1),
  );

  expect(consoleErrors).toEqual([]);
});
