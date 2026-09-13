import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import {
  POSTGRES_CAPS,
  postgresConnectionSummary,
  SERVER_VERSION,
} from './support/postgresFixture';

// P22b D14: the op log (workbench/panels/OperationsPanel.vue) is the fifth of the five search
// gaps F21 found. Its own always-visible filter (a TextField with icon="filter", opsState.ts's
// own filterText) already existed at b52fd72 — F21's grep for icon="search"/PanelSearchBox missed
// it — and already matched command/kind/error. The one real gap this phase closes is the
// connection's own name, which the row asks for explicitly ("the op label and its connection
// name") and which the pre-existing filter did not match.

const NOW = '2026-01-01T00:00:00.000Z';

function opRecord(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'op-1',
    connectionId: null,
    tabId: null,
    startedAt: NOW,
    durationMs: 12,
    kind: 'read',
    status: 'ok',
    rows: 3,
    command: 'select 1',
    error: null,
    ...overrides,
  };
}

test('Operations panel — the filter matches the connection name, not only the command', async ({
  relaunch,
}) => {
  const CONN = postgresConnectionSummary('conn-ops-1', 'Warehouse DB', 'blue');
  const OP_A = opRecord({ id: 'op-a', connectionId: 'conn-ops-1', command: 'select * from x' });
  const OP_B = opRecord({ id: 'op-b', connectionId: null, kind: 'http', command: 'GET /health' });

  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [CONN] },
    { channel: IPC.opsRecent, response: [OP_A, OP_B] },
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await page.click('[data-testid="toggle-operations-panel"]');
  const rows = page.locator('[data-testid="op-row"]');
  await expect(rows).toHaveCount(2);

  const filter = page.locator('[data-testid="ops-filter"]');
  await filter.fill('Warehouse');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Warehouse DB');

  await filter.fill('health');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('GET /health');

  await filter.fill('');
  await expect(rows).toHaveCount(2);
});

// P23 D1(c)/§4.4: commandTruncated disables Re-run but not Copy command — the one product surface
// this phase's op_log byte cap adds. Both rows share a connected connection (caps.sql: true) and a
// non-empty command, so a plain rows-not-connected/no-command guard cannot explain the difference
// — only commandTruncated can.
test('Operations panel — a truncated command cannot be re-run, but can still be copied', async ({
  relaunch,
}) => {
  const CONN = postgresConnectionSummary('conn-ops-2', 'Warehouse DB', 'blue');
  const TRUNCATED = opRecord({
    id: 'op-truncated',
    connectionId: 'conn-ops-2',
    command: 'select 1',
    commandTruncated: true,
  });
  const WHOLE = opRecord({
    id: 'op-whole',
    connectionId: 'conn-ops-2',
    command: 'select 2',
    commandTruncated: false,
  });

  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [CONN] },
    {
      channel: IPC.connectionsStates,
      response: [
        {
          connectionId: 'conn-ops-2',
          status: 'connected',
          serverVersion: SERVER_VERSION,
          error: null,
          since: 1735689600000,
          caps: POSTGRES_CAPS,
        },
      ],
    },
    { channel: IPC.opsRecent, response: [TRUNCATED, WHOLE] },
  ];
  const { window: page } = await relaunch({ control: CONTROL });

  await page.click('[data-testid="toggle-operations-panel"]');
  const rows = page.locator('[data-testid="op-row"]');
  await expect(rows).toHaveCount(2);

  await rows.filter({ hasText: 'select 1' }).click({ button: 'right' });
  await expect(page.locator('[data-testid="menu-item-re-run"]')).toHaveClass(/is-disabled/);
  await expect(page.locator('[data-testid="menu-item-copy-command"]')).not.toHaveClass(
    /is-disabled/,
  );
  await page.keyboard.press('Escape');

  await rows.filter({ hasText: 'select 2' }).click({ button: 'right' });
  await expect(page.locator('[data-testid="menu-item-re-run"]')).not.toHaveClass(/is-disabled/);
  await expect(page.locator('[data-testid="menu-item-copy-command"]')).not.toHaveClass(
    /is-disabled/,
  );
});
