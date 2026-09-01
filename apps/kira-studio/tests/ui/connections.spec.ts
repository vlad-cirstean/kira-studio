import type { ConnectionSummary } from '@shared/domain/connection';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { acceptConfirm } from './support/dialogs';
import { IPC } from './support/ipcChannels';

// Ported from tests/e2e/connections.spec.ts (P57 D16, per P57-cutover.md §11's
// connections/secrets finding). No real adapter needed — every scenario here only exercises
// connection CRUD against `ConnectionsService`'s canned responses, never `connectionsTest`/
// `Connect`. Two scenarios do not port: "create, wait, relaunch(), still there" and "recolor,
// wait, relaunch(), still cyan" both asserted real cross-process persistence, which this tier's
// `relaunch()` cannot prove (tests/ui/fixtures.ts's own header comment) — same category as
// workbench.spec.ts's five dropped scenarios. The P42 D34 "a connection stored with a retired
// colour still renders" scenario is reshaped rather than dropped: the original created it via a
// raw `window.kira.connectionsCreate(...)` call and relied on the real app's `connectionsChanged`
// broadcast event to pick it up with no explicit refresh — this tier has no Events.On mock (P57
// left that data plane covered, but not the control-plane push-event plane), so the retired-colour
// connection is seeded in the boot snapshot instead. That is arguably more faithful to the
// scenario's own premise anyway: a retired colour can only exist on a row created before the
// picker changed, i.e. one that was already there at launch, not one created through today's UI.

const RETIRED: ConnectionSummary = {
  id: 'conn-retired',
  name: 'Retired Colour Conn',
  kind: 'postgres',
  color: 'orange',
  mode: 'fields',
  readOnly: false,
  host: '127.0.0.1',
  port: 5432,
  database: 'retired',
  username: 'retired',
  uri: null,
  options: {},
  preconnect: null,
  preconnectSidecar: false,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const TEST_PG_BASE = {
  id: 'conn-test-pg',
  name: 'Test PG',
  kind: 'postgres' as const,
  mode: 'fields' as const,
  readOnly: false,
  host: '127.0.0.1',
  port: 5432,
  database: 'testdb',
  username: 'testuser',
  uri: null,
  options: {},
  preconnect: null,
  preconnectSidecar: false,
  sortOrder: 1,
  createdAt: '2026-01-01T00:00:01.000Z',
  updatedAt: '2026-01-01T00:00:01.000Z',
};

const TEST_PG_GREEN: ConnectionSummary = { ...TEST_PG_BASE, color: 'green' };
const TEST_PG_RED: ConnectionSummary = {
  ...TEST_PG_BASE,
  color: 'red',
  updatedAt: '2026-01-01T00:00:02.000Z',
};
const TEST_PG_CYAN: ConnectionSummary = {
  ...TEST_PG_BASE,
  color: 'cyan',
  updatedAt: '2026-01-01T00:00:03.000Z',
};

const URI_CONNECTION: ConnectionSummary = {
  id: 'conn-uri',
  name: 'URI Connection',
  kind: 'postgres',
  color: 'none',
  mode: 'uri',
  readOnly: false,
  host: null,
  port: null,
  database: null,
  username: null,
  uri: 'postgresql://uriuser@10.0.0.9:5555/uridb',
  options: {},
  preconnect: null,
  preconnectSidecar: false,
  sortOrder: 2,
  createdAt: '2026-01-01T00:00:04.000Z',
  updatedAt: '2026-01-01T00:00:04.000Z',
};

const DUPLICATE_OF_TEST_PG: ConnectionSummary = {
  ...TEST_PG_CYAN,
  id: 'conn-test-pg-copy',
  name: 'Test PG copy',
  sortOrder: 3,
  createdAt: '2026-01-01T00:00:05.000Z',
  updatedAt: '2026-01-01T00:00:05.000Z',
};

function connectionRow(page: import('@playwright/test').Page, name: string) {
  return page.locator('[data-testid="tree-row"][data-kind="connection"]').filter({ hasText: name });
}

const CONTROL: ControlSnapshot[] = [
  // Boot: the retired-colour row is the only pre-existing connection.
  { channel: IPC.connectionsList, response: [RETIRED] },

  {
    channel: IPC.connectionsCreate,
    args: {
      name: 'Test PG',
      kind: 'postgres',
      color: 'green',
      mode: 'fields',
      readOnly: false,
      host: '127.0.0.1',
      port: 5432,
      database: 'testdb',
      username: 'testuser',
      password: null,
      uri: null,
      options: {},
      preconnect: null,
      preconnectSidecar: false,
    },
    response: TEST_PG_GREEN,
  },
  // After Test PG is created.
  { channel: IPC.connectionsList, response: [RETIRED, TEST_PG_GREEN] },

  {
    channel: IPC.connectionsCreate,
    args: {
      name: 'URI Connection',
      kind: 'postgres',
      color: 'none',
      mode: 'uri',
      readOnly: false,
      host: '',
      port: 5432,
      database: null,
      username: null,
      password: null,
      uri: 'postgresql://uriuser:secretpw@10.0.0.9:5555/uridb',
      options: {},
      preconnect: null,
      preconnectSidecar: false,
    },
    response: URI_CONNECTION,
  },
  // After URI Connection is created.
  { channel: IPC.connectionsList, response: [RETIRED, TEST_PG_GREEN, URI_CONNECTION] },

  {
    channel: IPC.connectionsReveal,
    args: { id: URI_CONNECTION.id },
    response: { password: 'secretpw', error: null },
  },
  // Every `Edit` menu click on Test PG reveals its (password-less) secret first — same answer
  // every time, so a single snapshot for this id covers all three edit-opens below.
  {
    channel: IPC.connectionsReveal,
    args: { id: TEST_PG_GREEN.id },
    response: { password: null, error: null },
  },

  {
    channel: IPC.connectionsUpdate,
    args: {
      id: TEST_PG_GREEN.id,
      input: {
        name: 'Test PG',
        kind: 'postgres',
        mode: 'fields',
        readOnly: false,
        host: '127.0.0.1',
        port: 5432,
        database: 'testdb',
        username: 'testuser',
        uri: null,
        options: {},
        preconnect: null,
        preconnectSidecar: false,
        color: 'red',
        password: null,
      },
    },
    response: TEST_PG_RED,
  },
  {
    channel: IPC.connectionsUpdate,
    args: {
      id: TEST_PG_GREEN.id,
      input: {
        name: 'Test PG',
        kind: 'postgres',
        mode: 'fields',
        readOnly: false,
        host: '127.0.0.1',
        port: 5432,
        database: 'testdb',
        username: 'testuser',
        uri: null,
        options: {},
        preconnect: null,
        preconnectSidecar: false,
        color: 'cyan',
        password: null,
      },
    },
    response: TEST_PG_CYAN,
  },

  {
    channel: IPC.connectionsDuplicate,
    args: { id: TEST_PG_CYAN.id },
    response: DUPLICATE_OF_TEST_PG,
  },
  { channel: IPC.connectionsDelete, args: { id: DUPLICATE_OF_TEST_PG.id }, response: null },
];

test('connection dialog CRUD, colors, and D7/D9 secret handling', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: CONTROL });

  // --- P42 D34: a connection already stored with a retired colour (orange, dropped from the
  // picker by D35) still lists and still paints its own rail. ---------------------------------
  const retiredRow = await connectionRow(page, 'Retired Colour Conn');
  await expect(retiredRow).toBeVisible();
  await expect(retiredRow.locator('.p-tree-rail')).toHaveAttribute('style', /--kira-conn-orange/);

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

  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  const row = await connectionRow(page, 'Test PG');
  await expect(row).toBeVisible();
  await expect(row.locator('.p-tree-rail')).toHaveAttribute('style', /--kira-conn-green/);
  await expect(row.locator('.status-dot')).toHaveAttribute('data-status', 'disconnected');

  // D9 ("connectionsList never carries a password") is no longer checkable from here: there is
  // no `window.kira` any more (AGENTS.md's P57 finding) and no live wire to query — this tier's
  // `connectionsList` fixture is data this test itself wrote, so re-reading it back would only
  // prove the fixture matches itself. The real guarantee now lives at the layer that actually
  // implements it: `connectionSummarySchema.omit({ password: true })` (shared/domain/connection.ts)
  // plus the Go-side wire shape it mirrors.

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

  // What the backend actually stripped the password down to is this test's own fixture
  // (URI_CONNECTION), not something to re-query here (no `window.kira` any more — AGENTS.md's
  // P57 finding) — so what's left to prove from the UI is that the renderer displays whatever it
  // was handed correctly: the row renders, and re-opening it for edit still shows URI mode.
  const uriConnRow = await connectionRow(page, 'URI Connection');
  await expect(uriConnRow).toBeVisible();
  await uriConnRow.click({ button: 'right' });
  await page.click('[data-testid="menu-item-edit"]');
  await expect(page.locator('[data-testid="mode-uri"]')).toHaveClass(/active/);

  // P2 R2: opening a URI-mode connection for edit must not load a plaintext secret into the
  // draft — there is no password input to show it in while `mode === 'uri'` (the URI text is the
  // only thing this dialog exposes there). Flipping to fields mode is the only way to see what
  // the draft's password field actually holds — it must be empty, not a revealed secret.
  //
  // P14 D1: this now holds for both modes, for a stronger reason than P2 R2's own — the dialog no
  // longer reveals anything at all on open, fields or URI, so the CONTROL fixture's own
  // connectionsReveal snapshots above (for both URI_CONNECTION and TEST_PG_GREEN) go uncalled by
  // this spec now; that is expected, not a gap, since nothing here presses the eye button.
  await page.click('[data-testid="mode-fields"]');
  await expect(page.locator('[data-testid="connection-password"]')).toHaveValue('');
  await page.click('[data-testid="connection-cancel"]');

  // --- color change via the dialog and via the context menu, both apply -------------------
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

  // --- P42 D35: the picker offers exactly eight swatches (six hues + grey + none) -----------
  await (await connectionRow(page, 'Test PG')).click({ button: 'right' });
  await page.click('[data-testid="menu-item-edit"]');
  await expect(page.locator('.color-picker .swatch')).toHaveCount(8);
  await page.click('[data-testid="connection-cancel"]');

  // --- duplicate, then delete with confirm -------------------------------------------------
  const rowCount = () => page.locator('[data-testid="tree-row"][data-kind="connection"]').count();
  const beforeDuplicate = await rowCount();
  await (await connectionRow(page, 'Test PG')).click({ button: 'right' });
  await page.click('[data-testid="menu-item-duplicate"]');
  await expect.poll(rowCount).toBe(beforeDuplicate + 1);
  await expect(await connectionRow(page, 'Test PG copy')).toBeVisible();

  await (await connectionRow(page, 'Test PG copy')).click({ button: 'right' });
  await page.click('[data-testid="menu-item-delete"]');
  await acceptConfirm(page);
  await expect.poll(rowCount).toBe(beforeDuplicate);
});
