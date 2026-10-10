import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';
import type { ControlSnapshot } from './support/types';

// P132 Part 2 (§6.2): the Operations dock — Kira Space's git op log — over the shared OpLogPanel.
// Records are seeded through `opsRecent` and patched through the `kira:op:update` push; the Go ring
// itself is covered by internal/oplog and internal/gitsession/oplog_test.go.

const NOW = '2026-01-01T00:00:00.000Z';

function opRecord(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'op-1',
    startedAt: NOW,
    durationMs: 12,
    kind: 'branchCreate',
    status: 'ok',
    command: 'git branch feat main',
    error: null,
    repoRoot: '/work/alpha',
    repoName: 'alpha',
    source: 'Kira Space',
    cancellable: false,
    ...overrides,
  };
}

test('the dock spans the full shell width, flush under project and main', async ({ relaunch }) => {
  const { window } = await relaunch();
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

  // ±0.5px: Playwright geometry can land on a sub-pixel boundary even at integer CSS values.
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

test('seeded records render repo, source, kind and command', async ({ relaunch }) => {
  const CONTROL: ControlSnapshot[] = [
    {
      channel: IPC.opsRecent,
      response: [
        opRecord({ id: 'op-a' }),
        opRecord({
          id: 'op-b',
          kind: 'fetch',
          repoName: 'beta',
          repoRoot: '/work/beta',
          source: 'ADE board',
          command: 'git fetch origin',
        }),
      ],
    },
  ];
  const { window } = await relaunch({ control: CONTROL });
  await window.click('[data-testid="toggle-operations-panel"]');

  const rows = window.locator('[data-testid="op-row"]');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'alpha' })).toContainText('Kira Space');
  await expect(rows.filter({ hasText: 'alpha' })).toContainText('branchCreate');
  await expect(rows.filter({ hasText: 'alpha' })).toContainText('git branch feat main');
  await expect(rows.filter({ hasText: 'beta' })).toContainText('ADE board');
  await expect(rows.filter({ hasText: 'beta' })).toContainText('git fetch origin');
});

test('the filter matches the repository name', async ({ relaunch }) => {
  const CONTROL: ControlSnapshot[] = [
    {
      channel: IPC.opsRecent,
      response: [
        opRecord({ id: 'op-a' }),
        opRecord({ id: 'op-b', repoName: 'beta', repoRoot: '/work/beta', command: 'git status' }),
      ],
    },
  ];
  const { window } = await relaunch({ control: CONTROL });
  await window.click('[data-testid="toggle-operations-panel"]');
  const rows = window.locator('[data-testid="op-row"]');
  await expect(rows).toHaveCount(2);

  await window.locator('[data-testid="ops-filter"]').fill('beta');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('beta');
});

test('a live update patches the row from running to ok', async ({ relaunch }) => {
  const { window } = await relaunch();
  await window.click('[data-testid="toggle-operations-panel"]');
  const rows = window.locator('[data-testid="op-row"]');
  await expect(rows).toHaveCount(0);

  await emitWailsEvent(
    window,
    IPC.opUpdate,
    opRecord({ id: 'op-live', status: 'running', durationMs: null }),
  );
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute('data-status', 'running');

  await emitWailsEvent(window, IPC.opUpdate, opRecord({ id: 'op-live', durationMs: 40 }));
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute('data-status', 'ok');
});

test('cancel shows only on a running cancellable row and sends its id', async ({ relaunch }) => {
  const CONTROL: ControlSnapshot[] = [
    {
      channel: IPC.opsRecent,
      response: [
        opRecord({
          id: 'op-fetch',
          kind: 'fetch',
          status: 'running',
          durationMs: null,
          cancellable: true,
          command: 'git fetch origin',
        }),
        opRecord({
          id: 'op-push',
          kind: 'push',
          status: 'running',
          durationMs: null,
          cancellable: false,
          command: 'git push origin main',
        }),
      ],
    },
    { channel: IPC.opsCancel, response: null },
  ];
  const { window, control } = await relaunch({ control: CONTROL });
  await window.click('[data-testid="toggle-operations-panel"]');

  const rows = window.locator('[data-testid="op-row"]');
  await expect(rows).toHaveCount(2);
  const cancel = window.getByRole('button', { name: 'Cancel operation' });
  await expect(cancel).toHaveCount(1);
  await expect(rows.filter({ hasText: 'push' }).getByRole('button')).toHaveCount(0);

  await cancel.click();
  await expect
    .poll(() => control.log().filter((e) => e.channel === IPC.opsCancel))
    .toEqual([{ channel: IPC.opsCancel, args: { opId: 'op-fetch' } }]);
});
