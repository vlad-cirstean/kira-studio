import type { Locator, Page } from '@playwright/test';
import type { ConnectionColor } from '@shared/domain/connection';
import { expect, test } from './fixtures';
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  type PgFixture,
  startPostgres,
} from './support/pg';
import { expandRow, findRow, openRowMenu } from './support/tree';

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
// composite_pk has a genuine 2-column primary key and no inbound foreign key (tests/db's own
// fixture-table choice for the same reason, see tests/db/postgres.spec.ts) — a clean target for
// edit/insert/delete UI scenarios that doesn't trip a FK constraint no scenario here means to test.
const COMPOSITE_PATH = `${APP_PATH}/table:composite_pk`;

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

function gridCell(page: Page, row: number, column: string): Locator {
  return page.locator(`[data-testid="grid-cell"][data-row="${row}"][data-column="${column}"]`);
}

async function cellText(page: Page, row: number, column: string): Promise<string> {
  return (await gridCell(page, row, column)).innerText();
}

async function editCell(page: Page, row: number, column: string, value: string): Promise<void> {
  await gridCell(page, row, column).dblclick();
  const input = page.locator('[data-testid="grid-cell-input"]');
  await expect(input).toBeVisible();
  await input.fill(value);
  await input.press('Enter');
}

interface OpRecordLike {
  id: string;
  kind: string;
  status: string;
}

async function countOps(page: Page): Promise<OpRecordLike[]> {
  const all: OpRecordLike[] = await page.evaluate(() => window.kira.opsRecent({ limit: 1000 }));
  return all.filter((o) => o.kind === 'count');
}

test('mutations — edit, add, delete, preview, commit, discard, read-only guard', async ({
  kira,
}) => {
  test.setTimeout(300_000);
  if (!pg) throw new Error('postgres fixture did not start');
  const { window: page } = kira;

  const cfg = {
    host: pg.config.host,
    port: pg.config.port,
    database: pg.config.database,
    username: pg.config.username,
    password: pg.config.password,
  };
  await createConnection(page, cfg, {
    name: 'Mutations DB',
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

  const compositeRow = await findRow(page, COMPOSITE_PATH);
  await compositeRow.dblclick();
  const grid = page.locator('[data-testid="data-grid"]');
  await expect(grid).toBeVisible();
  await expect(page.locator('[data-testid="grid-header-cell"][data-column="name"]')).toBeVisible();

  // --- scenario 1: editing a cell stages it (tinted, not yet sent) ------------------------
  const originalName = await cellText(page, 0, 'name');
  await editCell(page, 0, 'name', 'edited via UI');
  await expect(gridCell(page, 0, 'name')).toHaveClass(/pending-edit/);
  expect(await cellText(page, 0, 'name')).toBe('edited via UI');
  await expect(page.locator('[data-testid="toolbar-commit-changes"]')).toBeVisible();
  await expect(page.locator('[data-testid="toolbar-discard-changes"]')).toBeVisible();

  // --- scenario 2: discard reverts every pending change -------------------------------------
  await page.click('[data-testid="toolbar-discard-changes"]');
  await expect(page.locator('[data-testid="toolbar-commit-changes"]')).toHaveCount(0);
  expect(await cellText(page, 0, 'name')).toBe(originalName);

  // --- scenario 3: add row appends an always-editable insert row ---------------------------
  await page.click('[data-testid="toolbar-add-row"]');
  const insertRow = page.locator('[data-testid="grid-row-insert"]');
  await expect(insertRow).toHaveCount(1);
  const insertId = await insertRow.getAttribute('data-insert-id');
  expect(insertId).not.toBeNull();
  const insertInputs = insertRow.locator('[data-testid="grid-cell-insert"] input');
  await insertInputs.nth(0).fill('9');
  await insertInputs.nth(1).fill('1');
  await insertInputs.nth(2).fill('inserted row');

  // --- scenario 4: preview command shows the exact SQL for pending changes -----------------
  await page.click('[data-testid="toolbar-preview-command"]');
  const previewPanel = page.locator('[data-testid="preview-command-panel"]');
  await expect(previewPanel).toBeVisible();
  await expect(previewPanel.locator('.cm-content')).toBeVisible({ timeout: 10_000 });
  const previewText = await previewPanel.locator('.cm-content').innerText();
  expect(previewText).toContain('INSERT INTO');
  expect(previewText).toContain('composite_pk');
  await page.click('[data-testid="preview-command-close"]');
  await expect(previewPanel).toHaveCount(0);

  // Discard the insert before moving to the delete/commit scenarios below, so they start clean.
  await page.click('[data-testid="toolbar-discard-changes"]');
  await expect(insertRow).toHaveCount(0);

  // --- scenario 5: delete-row marks a row struck-through, non-committed until commit -------
  await page.locator('[data-testid="grid-gutter-cell"]').nth(1).click();
  await page.click('[data-testid="toolbar-delete-row"]');
  const deletedRow = page.locator('[data-testid="grid-row"][data-row="1"]');
  await expect(deletedRow).toHaveClass(/pending-delete/);

  // --- scenario 6: commit sends the batch and reloads the tab ------------------------------
  // Establish a known count first — F21/D18's stale marking has nothing to grey otherwise.
  const countButton = page.locator('[data-testid="toolbar-count"]');
  await countButton.click();
  // The count button is icon-only (no visible badge) — the number lives in its title tooltip;
  // `toHaveAttribute` polls, so this also waits out runCount()'s async round-trip (a one-shot
  // getAttribute right after click can read the pre-count fallback text).
  await expect(countButton).toHaveAttribute('data-kira-tip', /Count all rows — Σ \d/, {
    timeout: 10_000,
  });
  const countBeforeCommit = await countButton.getAttribute('data-kira-tip');
  const opsBeforeCommit = await countOps(page);

  const deletedRowName = await cellText(page, 1, 'name');
  await editCell(page, 0, 'name', 'committed value');
  await page.click('[data-testid="toolbar-commit-changes"]');
  await expect(page.locator('[data-testid="toolbar-commit-changes"]')).toHaveCount(0);
  await expect(gridCell(page, 0, 'name')).not.toHaveClass(/pending-edit/);
  // DataToolbar's onCommit awaits commitPending() (which clears pending-edit state — the two
  // assertions above — as soon as the mutate round-trip resolves) and only then awaits
  // reloadAfterMutation() as a separate step. So the button/class already reflect a committed
  // state before the grid has re-fetched it — a plain one-shot read here would race the reload
  // under load; toHaveText polls until the fetched row actually lands.
  await expect(gridCell(page, 0, 'name')).toHaveText('committed value', { timeout: 10_000 });
  const remainingNames = await page
    .locator('[data-testid="grid-cell"][data-column="name"]')
    .allInnerTexts();
  expect(remainingNames).not.toContain(deletedRowName);

  // §7/F21/D18: a local mutation greys the count instead of blanking it — same total, a
  // "(stale, click to refresh)" tooltip suffix (the visible signal is an inline warn-colour
  // style now, not a class — 7641dd6a's icon-only toolbar pass dropped the .stale class and
  // .codicon-refresh icon in favour of the tooltip text) — and picking that up costs no new
  // count op (it's an L3 cache hit, §7's "keep the number, grey it, let the user decide").
  await expect(countButton).toHaveAttribute('data-kira-tip', /stale, click to refresh/, {
    timeout: 10_000,
  });
  expect(await countButton.getAttribute('data-kira-tip')).toBe(
    `${countBeforeCommit} (stale, click to refresh)`,
  );
  expect(await countOps(page)).toHaveLength(opsBeforeCommit.length);

  // Clicking it through produces exactly one new count op and clears the stale mark.
  await countButton.click();
  await expect.poll(async () => (await countOps(page)).length).toBe(opsBeforeCommit.length + 1);
  await expect(countButton).not.toHaveAttribute('data-kira-tip', /stale/, { timeout: 10_000 });
  // The delete actually shrank the table by one row — the refreshed total proves this was a
  // real recount, not just a stale-flag flip.
  expect(await countButton.getAttribute('data-kira-tip')).not.toBe(countBeforeCommit);

  // --- P43 F5/D7: a failed commit reports the server's own error, not an unhandled rejection —
  // (1, 1) is the surviving row from scenario 6's own edit, so a fresh insert of the same
  // composite key violates the PK. -----------------------------------------------------------
  await page.click('[data-testid="toolbar-add-row"]');
  const dupInsertRow = page.locator('[data-testid="grid-row-insert"]');
  await expect(dupInsertRow).toHaveCount(1);
  const dupInsertInputs = dupInsertRow.locator('[data-testid="grid-cell-insert"] input');
  await dupInsertInputs.nth(0).fill('1');
  await dupInsertInputs.nth(1).fill('1');
  await dupInsertInputs.nth(2).fill('duplicate key');
  await page.click('[data-testid="toolbar-commit-changes"]');
  const actionError = page.locator('[data-testid="data-action-error"]');
  await expect(actionError).toBeVisible();
  await expect(actionError).toContainText(/duplicate key|unique/i);
  await expect(dupInsertRow).toHaveCount(1); // the staged insert survives the failure
  await page.click('[data-testid="toolbar-discard-changes"]');
  await expect(dupInsertRow).toHaveCount(0);
  await expect(actionError).toHaveCount(0);

  // --- scenario 7: a read-only connection disables every mutation button ------------------
  const firstConnRow = page.locator('[data-testid="tree-row"][data-kind="connection"]');
  await expect(firstConnRow).toHaveCount(1);
  await firstConnRow.locator('.twisty').click();

  await createConnection(page, cfg, { name: 'Mutations DB (RO)', color: 'red', readOnly: true });
  const roConnRow = page
    .locator('[data-testid="tree-row"][data-kind="connection"]')
    .filter({ hasText: 'Mutations DB (RO)' });
  await expect(roConnRow).toBeVisible();
  await roConnRow.click({ button: 'right' });
  await page.click('[data-testid="menu-item-connect"]');
  await expect(roConnRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });
  await roConnRow.locator('.twisty').click();
  await expandRow(page, DB_PATH);
  await expandRow(page, APP_PATH);
  const roCompositeRow = await findRow(page, COMPOSITE_PATH);
  await roCompositeRow.dblclick();
  await expect(page.locator('[data-testid="grid-header-cell"][data-column="name"]')).toBeVisible();

  for (const testId of ['toolbar-add-row', 'toolbar-delete-row']) {
    await expect(page.locator(`[data-testid="${testId}"]`)).toBeDisabled();
  }
  // Preview-command now only renders alongside the pending-changes group (P16 toolbar-order
  // cleanup) — a read-only connection can never stage a pending change in the first place, so
  // there is nothing to preview and the button is absent rather than present-but-disabled.
  await expect(page.locator('[data-testid="toolbar-preview-command"]')).toHaveCount(0);
});
