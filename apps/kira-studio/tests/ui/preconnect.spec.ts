import type { ConnectionSummary } from '@shared/domain/connection';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';

// Ported from tests/e2e/preconnect.spec.ts (P57 D16). That file is split in two, mirroring
// connections.spec.ts/tree.spec.ts's own discipline: a dialog+failure-before-connect half that
// needs no real adapter, and a "sidecar lifecycle against a live connection" half that spawns a
// real shell process and inspects its real PID on the filesystem. Only the first half ports —
// the second has no equivalent in a tier with no real backend process to spawn or supervise
// (same reasoning as workbench.spec.ts's dropped relaunch scenarios), and is covered instead by
// apps/kira-studio/internal/preconnect/supervisor_test.go and tail_test.go (real Go coverage of exactly the
// exit-drops-the-connection and one-shot-exit-is-fine behaviors that half asserted).
//
// Two of the first half's own checks are also dropped: "saving persists it" and "the stored value
// survives a relaunch" both needed a real relaunch to prove (tests/ui/fixtures.ts's own header
// comment — there is nothing to persist to here). What's left — the field's visibility in both
// modes, the warning's reactivity, editing the just-created record in the same session, and the
// clear-to-null normalization — still exercises real renderer logic: `preconnectText`'s computed
// setter (`ConnectionDialog.vue`) converts an empty string to `null` before it ever reaches the
// wire, and this test's own exact-arg-matching fixture is what proves that (a regression back to
// sending `''` would 422 here, loudly, rather than pass silently).

const CREATED: ConnectionSummary = {
  id: 'conn-preconnect',
  name: 'Preconnect Test',
  kind: 'postgres',
  color: 'none',
  mode: 'fields',
  readOnly: false,
  host: '127.0.0.1',
  port: 5432,
  database: 'testdb',
  username: 'testuser',
  uri: null,
  options: {},
  preconnect: 'echo hi',
  preconnectSidecar: false,
  autoExplain: false,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const FAILED_CONNECT: ConnectionSummary = { ...CREATED, preconnect: null, port: 1 };

const CONTROL: ControlSnapshot[] = [
  { channel: IPC.connectionsList, response: [] },
  {
    channel: IPC.connectionsCreate,
    args: {
      name: 'Preconnect Test',
      kind: 'postgres',
      color: 'none',
      mode: 'fields',
      readOnly: false,
      host: '127.0.0.1',
      port: 5432,
      database: 'testdb',
      username: 'testuser',
      password: null,
      uri: null,
      options: {},
      preconnect: 'echo hi',
      preconnectSidecar: false,
      autoExplain: false,
    },
    response: CREATED,
  },
  // No connectionsReveal snapshot for CREATED's edit-reopens below — P14 D1 stopped fetching the
  // secret just to open the dialog.
  {
    channel: IPC.connectionsUpdate,
    args: {
      id: CREATED.id,
      input: {
        name: 'Preconnect Test',
        kind: 'postgres',
        color: 'none',
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
        autoExplain: false,
        password: null,
      },
    },
    response: { ...CREATED, preconnect: null },
  },
  {
    channel: IPC.connectionsUpdate,
    args: {
      id: CREATED.id,
      input: {
        name: 'Preconnect Test',
        kind: 'postgres',
        color: 'none',
        mode: 'fields',
        readOnly: false,
        host: '127.0.0.1',
        port: 1,
        database: 'testdb',
        username: 'testuser',
        uri: null,
        options: {},
        preconnect: 'echo nope >&2; exit 3',
        preconnectSidecar: false,
        autoExplain: false,
        password: null,
      },
    },
    response: FAILED_CONNECT,
  },
  {
    channel: IPC.connectionsConnect,
    args: { id: CREATED.id },
    response: {
      connectionId: CREATED.id,
      status: 'error',
      serverVersion: null,
      error: 'Pre-connect script exited (echo nope >&2; exit 3): exit 3\nnope',
      since: 1735689600000,
      caps: null,
    },
  },
];

function connectionRow(page: import('@playwright/test').Page, name: string) {
  return page.locator('[data-testid="tree-row"][data-kind="connection"]').filter({ hasText: name });
}

test('preconnect — dialog field, and failure before connect', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: CONTROL });

  // --- the field is visible in both fields and URI mode -------------------------------------
  await page.click('[data-testid="add-connection"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toBeVisible();
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.click('[data-testid="connection-tab-preconnect"]');
  await expect(page.locator('[data-testid="connection-preconnect"]')).toBeVisible();
  await expect(page.locator('[data-testid="connection-preconnect-warning"]')).toHaveCount(0);
  await page.click('[data-testid="mode-uri"]');
  await expect(page.locator('[data-testid="connection-preconnect"]')).toBeVisible();
  await page.click('[data-testid="connection-cancel"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);
  await page.click('[data-testid="add-connection"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toBeVisible();
  await page.click('[data-testid="connection-kind-postgres"]');

  // --- typing a command shows the warning, saving sends it ----------------------------------
  await page.fill('[data-testid="connection-name"]', 'Preconnect Test');
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '5432');
  await page.fill('[data-testid="connection-database"]', 'testdb');
  await page.fill('[data-testid="connection-username"]', 'testuser');
  await page.click('[data-testid="connection-tab-preconnect"]');
  await page.fill('[data-testid="connection-preconnect"]', 'echo hi');
  await expect(page.locator('[data-testid="connection-preconnect-warning"]')).toBeVisible();
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  // --- editing the just-created record shows it again ----------------------------------------
  await (await connectionRow(page, 'Preconnect Test')).click({ button: 'right' });
  await page.click('[data-testid="menu-item-edit"]');
  await page.click('[data-testid="connection-tab-preconnect"]');
  await expect(page.locator('[data-testid="connection-preconnect"]')).toHaveValue('echo hi');
  await expect(page.locator('[data-testid="connection-preconnect-warning"]')).toBeVisible();

  // --- clearing the field and saving sends null, not '' --------------------------------------
  await page.fill('[data-testid="connection-preconnect"]', '');
  await expect(page.locator('[data-testid="connection-preconnect-warning"]')).toHaveCount(0);
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  // --- a failing script aborts the connect before the adapter is ever contacted --------------
  await (await connectionRow(page, 'Preconnect Test')).click({ button: 'right' });
  await page.click('[data-testid="menu-item-edit"]');
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '1'); // nothing listens here
  await page.click('[data-testid="connection-tab-preconnect"]');
  await page.fill('[data-testid="connection-preconnect"]', 'echo nope >&2; exit 3');
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  const failRow = await connectionRow(page, 'Preconnect Test');
  await failRow.click({ button: 'right' });
  await page.click('[data-testid="menu-item-connect"]');
  await expect(failRow.locator('.status-dot')).toHaveAttribute('data-status', 'error', {
    timeout: 10_000,
  });
  await expect(failRow.locator('.status-dot')).toHaveAttribute('data-kira-tip', /exit 3/);
  await expect(failRow.locator('.status-dot')).toHaveAttribute('data-kira-tip', /nope/);
});
