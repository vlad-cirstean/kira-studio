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
  await expect(page.locator('[data-testid="menu-item-re-run"]')).toHaveAttribute(
    'data-disabled',
    '',
  );
  await expect(page.locator('[data-testid="menu-item-copy-command"]')).not.toHaveAttribute(
    'data-disabled',
  );
  await page.keyboard.press('Escape');

  await rows.filter({ hasText: 'select 2' }).click({ button: 'right' });
  await expect(page.locator('[data-testid="menu-item-re-run"]')).not.toHaveAttribute(
    'data-disabled',
  );
  await expect(page.locator('[data-testid="menu-item-copy-command"]')).not.toHaveAttribute(
    'data-disabled',
  );
});

// P132 Part 1 (§4.1): the row's own acceptance for the full-width dock fix (§0.1/§2.4) — the dock
// no longer sits in a nested SplitterGroup under just the main panel, so it spans project's left
// edge to main's right edge, and project's own bottom now moves with main's (no more blank strip
// below a shorter project panel, no margin hack to produce it).
test('Operations panel — the dock spans the full shell width, flush under project and main (P132 Part 1)', async ({
  kira,
}) => {
  const { window } = kira;
  await window.click('[data-testid="toggle-operations-panel"]');
  const dock = window.locator('[data-testid="operations-panel"]');
  await expect(dock).toBeVisible();

  const project = window.locator('[data-testid="project-panel"]');
  const main = window.locator('[data-testid="main-panel"]');
  const [projectBox, mainBox, dockBox, marginBottom] = await Promise.all([
    project.boundingBox(),
    main.boundingBox(),
    dock.boundingBox(),
    project.evaluate((el) => getComputedStyle(el).marginBottom),
  ]);
  if (!projectBox || !mainBox || !dockBox) throw new Error('bounding boxes not found');

  // ±0.5px throughout (the row's own tolerance) — Playwright geometry can land on a sub-pixel
  // boundary even at integer CSS values.
  expect(Math.abs(dockBox.x - projectBox.x)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(dockBox.x + dockBox.width - (mainBox.x + mainBox.width))).toBeLessThanOrEqual(
    0.5,
  );
  expect(
    Math.abs(projectBox.y + projectBox.height - (mainBox.y + mainBox.height)),
  ).toBeLessThanOrEqual(0.5);
  expect(Math.abs(dockBox.y - (projectBox.y + projectBox.height) - 6)).toBeLessThanOrEqual(0.5);
  expect(marginBottom).toBe('0px');
});

// P132 Part 1 (§4.1): drag, keyboard step, and clamp — DockResizeHandle.vue's own three behaviours
// (§2.4), exercised through the real separator rather than unit-testing its clamp math directly.
test('Operations panel — the dock resize handle drags, steps by keyboard, and clamps (P132 Part 1)', async ({
  kira,
}) => {
  const { window } = kira;
  await window.click('[data-testid="toggle-operations-panel"]');
  const dock = window.locator('[data-testid="operations-panel"]');
  await expect(dock).toBeVisible();
  // The project panel's own reka SplitterResizeHandle is also role="separator" — this one is
  // named (DockResizeHandle.vue's own aria-label) to disambiguate.
  const handle = window.getByRole('separator', { name: 'Resize operations panel' });

  const initialBox = await dock.boundingBox();
  if (!initialBox) throw new Error('dock bounding box not found');
  const initialHeight = initialBox.height;

  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error('handle bounding box not found');
  const cx = handleBox.x + handleBox.width / 2;
  const cy = handleBox.y + handleBox.height / 2;
  await window.mouse.move(cx, cy);
  await window.mouse.down();
  await window.mouse.move(cx, cy - 60, { steps: 5 });
  await window.mouse.up();
  const afterDragHeight = (await dock.boundingBox())?.height ?? 0;
  expect(Math.abs(afterDragHeight - initialHeight - 60)).toBeLessThanOrEqual(1);

  await handle.focus();
  await window.keyboard.press('ArrowUp');
  const afterArrowHeight = (await dock.boundingBox())?.height ?? 0;
  expect(Math.abs(afterArrowHeight - afterDragHeight - 10)).toBeLessThanOrEqual(1);

  const clampHandleBox = await handle.boundingBox();
  if (!clampHandleBox) throw new Error('handle bounding box not found');
  const clampCx = clampHandleBox.x + clampHandleBox.width / 2;
  const clampCy = clampHandleBox.y + clampHandleBox.height / 2;
  await window.mouse.move(clampCx, clampCy);
  await window.mouse.down();
  await window.mouse.move(clampCx, clampCy - 1000, { steps: 5 });
  await window.mouse.up();
  const clampedHeight = (await dock.boundingBox())?.height ?? 0;
  expect(Math.abs(clampedHeight - 500)).toBeLessThanOrEqual(1);
});
