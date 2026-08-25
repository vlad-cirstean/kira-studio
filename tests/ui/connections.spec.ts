import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// No container needed — every scenario here only exercises connection CRUD against the local
// SQLite store, never a real database connect. Must never skip (§12b), unlike tree.spec.ts.
//
// The Playwright Page fixture is bound to a local variable named `page` (not `window`, unlike
// fixtures.ts's own naming) so that a bare `window` reference inside a `page.evaluate()`
// callback below resolves to the real browser global (`window.kira`, from src/preload/index.ts)
// instead of being shadowed by a same-named local variable — see tests/ui/global.d.ts.

const PERSIST_SETTLE_MS = 300;

interface ConnectionSummaryLike {
  id: string;
  name: string;
  color: string;
  uri: string | null;
  mode: string;
  [key: string]: unknown;
}

async function listConnections(page: Page): Promise<ConnectionSummaryLike[]> {
  return page.evaluate(() => window.kira.connectionsList());
}

async function connectionRow(page: Page, name: string) {
  return page.locator('[data-testid="tree-row"][data-kind="connection"]').filter({ hasText: name });
}

test('connection dialog CRUD, colors, and D7/D9 secret handling', async ({ relaunch }) => {
  let { window: page } = await relaunch();

  // --- create through the dialog (fields mode) -------------------------------------------
  await page.click('[data-testid="add-connection"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toBeVisible();
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', 'Test PG');
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '5432');

  // --- P42 F16: the port field's numeric stepper draws both chevrons wholly inside their own
  // buttons, not spilling into a sibling or out of the field (a CSS regression guard). --------
  const portInput = page.locator('[data-testid="connection-port"]');
  const stepButtons = portInput.locator('xpath=parent::span').locator('.step-btn');
  await expect(stepButtons).toHaveCount(2);
  for (const btn of await stepButtons.all()) {
    const btnBox = await btn.boundingBox();
    const iconBox = await btn.locator('.codicon').boundingBox();
    expect(btnBox).not.toBeNull();
    expect(iconBox).not.toBeNull();
    if (btnBox && iconBox) {
      expect(iconBox.y).toBeGreaterThanOrEqual(btnBox.y - 0.5);
      expect(iconBox.y + iconBox.height).toBeLessThanOrEqual(btnBox.y + btnBox.height + 0.5);
      expect(iconBox.x).toBeGreaterThanOrEqual(btnBox.x - 0.5);
      expect(iconBox.x + iconBox.width).toBeLessThanOrEqual(btnBox.x + btnBox.width + 0.5);
    }
  }

  await page.fill('[data-testid="connection-database"]', 'testdb');
  await page.fill('[data-testid="connection-username"]', 'testuser');
  await page.click('[data-testid="color-green"]');

  await page.screenshot({ path: 'test-results/screenshots/connection-dialog.png' });

  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  const row = await connectionRow(page, 'Test PG');
  await expect(row).toBeVisible();
  await expect(row.locator('.p-tree-rail')).toHaveAttribute('style', /--kira-conn-green/);
  await expect(row.locator('.status-dot')).toHaveAttribute('data-status', 'disconnected');

  await page.waitForTimeout(PERSIST_SETTLE_MS);
  ({ window: page } = await relaunch());
  await expect(await connectionRow(page, 'Test PG')).toBeVisible();

  // --- D9: connectionsList() never carries a password, on any record ---------------------
  const afterCreate = await listConnections(page);
  expect(afterCreate.length).toBeGreaterThan(0);
  for (const record of afterCreate) {
    expect(Object.hasOwn(record, 'password')).toBe(false);
  }

  // --- URI mode: fields -> URI generates a matching URI -----------------------------------
  await (await connectionRow(page, 'Test PG')).click({ button: 'right' });
  await page.click('[data-testid="menu-item-edit"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toBeVisible();
  await page.click('[data-testid="mode-uri"]');
  const generatedUri = await page.inputValue('[data-testid="connection-uri"]');
  expect(generatedUri).toMatch(/^postgresql:\/\//);
  expect(generatedUri).toContain('127.0.0.1:5432');
  expect(generatedUri).toContain('testdb');

  // Type an exotic (multi-host) URI, then try to flip back to fields mode — it must refuse
  // and explain why (§8.12).
  await page.fill('[data-testid="connection-uri"]', 'postgres://u:p@a.example,b.example/db');
  await page.click('[data-testid="mode-fields"]');
  await expect(page.locator('[data-testid="mode-uri"]')).toHaveClass(/active/);
  await expect(page.locator('[data-testid="connection-host"]')).toHaveCount(0);
  await expect(page.locator('.uri-note')).toContainText('cannot be represented as fields');

  // Discard — do not persist this exotic-URI draft.
  await page.click('[data-testid="connection-cancel"]');

  // --- URI mode with an embedded password: stored URI is passwordless, reveal() has it ----
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', 'URI Connection');
  await page.click('[data-testid="mode-uri"]');
  await page.fill(
    '[data-testid="connection-uri"]',
    'postgresql://uriuser:secretpw@10.0.0.9:5555/uridb',
  );
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  const withUriConn = (await listConnections(page)).find((r) => r.name === 'URI Connection');
  expect(withUriConn).toBeDefined();
  expect(withUriConn?.mode).toBe('uri');
  expect(withUriConn?.uri).not.toContain('secretpw');
  expect(withUriConn?.uri).toContain('uriuser');
  const revealed = await page.evaluate(
    (id) => window.kira.connectionsReveal({ id }),
    withUriConn?.id as string,
  );
  expect(revealed.password).toBe('secretpw');

  // --- color change via the dialog and via the context menu, both persist -----------------
  await (await connectionRow(page, 'Test PG')).click({ button: 'right' });
  await page.click('[data-testid="menu-item-edit"]');
  await page.click('[data-testid="color-red"]');
  await page.click('[data-testid="connection-save"]');
  await expect((await connectionRow(page, 'Test PG')).locator('.p-tree-rail')).toHaveAttribute(
    'style',
    /--kira-conn-red/,
  );

  await (await connectionRow(page, 'Test PG')).click({ button: 'right' });
  await page.hover('[data-testid="menu-item-color"]');
  await page.click('[data-testid="menu-item-color-cyan"]');
  await expect((await connectionRow(page, 'Test PG')).locator('.p-tree-rail')).toHaveAttribute(
    'style',
    /--kira-conn-cyan/,
  );

  await page.waitForTimeout(PERSIST_SETTLE_MS);
  ({ window: page } = await relaunch());
  await expect((await connectionRow(page, 'Test PG')).locator('.p-tree-rail')).toHaveAttribute(
    'style',
    /--kira-conn-cyan/,
  );

  // --- P42 D35: the picker offers exactly eight swatches (six hues + grey + none) -----------
  await (await connectionRow(page, 'Test PG')).click({ button: 'right' });
  await page.click('[data-testid="menu-item-edit"]');
  await expect(page.locator('.color-picker .swatch')).toHaveCount(8);
  await page.click('[data-testid="connection-cancel"]');

  // --- P42 D34: a connection already stored with a retired colour (orange, dropped from the
  // picker by D35) still lists and still paints its own rail — the standing proof that the split
  // between "storable" and "offered" holds in what the tree actually renders, not just the schema.
  await page.evaluate(() =>
    window.kira.connectionsCreate({
      name: 'Retired Colour Conn',
      kind: 'postgres',
      color: 'orange',
      mode: 'fields',
      readOnly: false,
      host: '127.0.0.1',
      port: 5432,
      database: 'retired',
      username: 'retired',
      password: null,
      uri: null,
      options: {},
      preconnect: null,
      preconnectSidecar: false,
    }),
  );
  const retiredRow = await connectionRow(page, 'Retired Colour Conn');
  await expect(retiredRow).toBeVisible();
  await expect(retiredRow.locator('.p-tree-rail')).toHaveAttribute('style', /--kira-conn-orange/);
  const retiredRecord = (await listConnections(page)).find((r) => r.name === 'Retired Colour Conn');
  expect(retiredRecord?.color).toBe('orange');

  // --- duplicate, then delete with confirm -------------------------------------------------
  const beforeDuplicate = (await listConnections(page)).length;
  await (await connectionRow(page, 'Test PG')).click({ button: 'right' });
  await page.click('[data-testid="menu-item-duplicate"]');
  await expect.poll(async () => (await listConnections(page)).length).toBe(beforeDuplicate + 1);

  const duplicated = (await listConnections(page)).find((r) => r.name === 'Test PG copy');
  expect(duplicated).toBeDefined();

  page.once('dialog', (dialog) => dialog.accept());
  await (await connectionRow(page, 'Test PG copy')).click({ button: 'right' });
  await page.click('[data-testid="menu-item-delete"]');
  await expect.poll(async () => (await listConnections(page)).length).toBe(beforeDuplicate);
});
