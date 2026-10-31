import type { ContractJson } from '@workbench/testing/ui/contract';
import { expect, test } from './fixtures';
import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';
import type { ControlSnapshot } from './support/types';

// P415: the Operations dock — Kira Space's op log (git spawns, agent sessions, MCP calls) — over
// the shared OpLogPanel. Records are seeded through `opsRecent`, patched through `kira:op:update`
// and background reads arrive on `kira:op:batch`. Backend halves: appflow TestOpsEveryGitSpawn
// (space-ops) and adeflow TestOpsAde (space-ops-ade).

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
    category: 'git',
    module: 'git',
    trigger: 'user',
    subject: '',
    repoRoot: '/work/alpha',
    repoName: 'alpha',
    source: 'Kira Space',
    taskId: '',
    parentId: '',
    background: false,
    repeat: 1,
    steps: [],
    stepsDropped: 0,
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

async function openDock(
  relaunch: Parameters<Parameters<typeof test>[2]>[0]['relaunch'],
  records: Record<string, unknown>[],
) {
  const CONTROL: ControlSnapshot[] = [{ channel: IPC.opsRecent, response: records }];
  const launched = await relaunch({ control: CONTROL });
  await launched.window.click('[data-testid="toggle-operations-panel"]');
  return launched;
}

test('module, source and subject columns show where an op came from', async ({ relaunch }) => {
  const mcp = {
    ...contract<ContractJson>('space-ops-ade', 'record#mcp'),
    id: 'op-mcp',
    startedAt: NOW,
  };
  const run = {
    ...contract<ContractJson>('space-ops-ade', 'record#run'),
    id: 'op-run',
    startedAt: NOW,
    durationMs: 5,
  };
  const { window } = await openDock(relaunch, [mcp, run, opRecord({ id: 'op-git' })]);
  const rows = window.locator('[data-testid="op-row"]');
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: 'request_branches' })).toContainText('MCP request_branches');
  await expect(rows.filter({ hasText: 'request_branches' })).toContainText('Fix login');
  await expect(rows.filter({ hasText: 'run' }).first()).toContainText('Claude');
  await expect(rows.filter({ hasText: 'branchCreate' })).toContainText('alpha');
});

test('background reads stay hidden until the toggle, and do not count as running', async ({
  relaunch,
}) => {
  const bare = {
    ...contract<ContractJson[]>('space-ops', 'event:kira:op:batch#background')[0],
    id: 'op-bg',
    startedAt: NOW,
    status: 'running',
    durationMs: null,
  };
  const { window } = await openDock(relaunch, [opRecord({ id: 'op-fg' })]);
  const rows = window.locator('[data-testid="op-row"]');
  await expect(rows).toHaveCount(1);

  await emitWailsEvent(window, IPC.opBatch, [bare]);
  await expect(rows).toHaveCount(1);
  await expect(window.getByText('Running: 0')).toBeVisible();

  await window.locator('[data-testid="ops-background"]').click();
  await expect(rows).toHaveCount(2);
  await expect(window.getByText('Running: 0')).toBeVisible();
});

test('an expanded op lists its steps, with the stderr of a failed one', async ({ relaunch }) => {
  const write = contract<ContractJson>('space-ops', 'record#write');
  const failing = {
    ...write,
    id: 'op-steps',
    startedAt: NOW,
    status: 'error',
    error: 'git failed',
    steps: [
      ...write.steps.map((s: Record<string, unknown>) => ({ ...s, durationMs: 3 })),
      {
        argv: 'git push origin main',
        readOnly: false,
        exitCode: 1,
        durationMs: 9,
        status: 'error',
        stderr: 'remote: denied',
      },
    ],
  };
  const { window } = await openDock(relaunch, [failing]);
  await window.locator('[data-testid="op-row"]').first().click();
  const lines = window.locator('[data-testid="op-detail-line"]');
  await expect(lines.first()).toContainText('git ');
  await expect(lines.filter({ hasText: 'exit 1' })).toBeVisible();
  await expect(lines.filter({ hasText: 'remote: denied' })).toBeVisible();
});

test('Copy details and Copy error write the clipboard', async ({ relaunch }) => {
  const rec = opRecord({
    id: 'op-copy',
    status: 'error',
    error: 'fatal: nope',
    steps: [
      {
        argv: 'git push',
        readOnly: false,
        exitCode: 1,
        durationMs: 4,
        status: 'error',
        stderr: 'fatal: nope',
      },
    ],
  });
  const { window } = await openDock(relaunch, [rec]);
  await window.evaluate(() => {
    const w = window as unknown as { __clipboard: string[] };
    w.__clipboard = [];
    navigator.clipboard.writeText = async (text: string) => {
      w.__clipboard.push(text);
    };
  });
  const clip = () =>
    window.evaluate(() => (window as unknown as { __clipboard: string[] }).__clipboard);

  await window.locator('[data-testid="op-row"]').first().click({ button: 'right' });
  await window.getByRole('menuitem', { name: 'Copy details' }).click();
  await expect.poll(clip).toHaveLength(1);
  expect((await clip())[0]).toContain('git branch feat main');
  expect((await clip())[0]).toContain('git push');
  expect((await clip())[0]).toContain('fatal: nope');

  await window.locator('[data-testid="op-row"]').first().click({ button: 'right' });
  await window.getByRole('menuitem', { name: 'Copy error' }).click();
  await expect.poll(clip).toHaveLength(2);
  expect((await clip())[1]).toBe('fatal: nope');
});

test('a repeated background failure shows its count', async ({ relaunch }) => {
  const { window } = await openDock(relaunch, [
    opRecord({ id: 'op-rep', status: 'error', error: 'fatal: x', background: true, repeat: 2 }),
  ]);
  await window.locator('[data-testid="ops-background"]').click();
  await expect(window.locator('[data-testid="op-status-note"]')).toHaveText('×2');
});

test('a running session op shows Cancel and sends its id', async ({ relaunch }) => {
  const running = {
    ...contract<ContractJson>('space-ops-ade', 'record#running'),
    id: 'op-session',
    startedAt: NOW,
  };
  const { window, control } = await openDock(relaunch, [running]);
  await window.getByRole('button', { name: 'Cancel operation' }).click();
  await expect
    .poll(() => control.log().filter((e) => e.channel === IPC.opsCancel))
    .toEqual([{ channel: IPC.opsCancel, args: { opId: 'op-session' } }]);
});

test('a child op names the MCP tool that started it', async ({ relaunch }) => {
  const parent = {
    ...contract<ContractJson>('space-ops-ade', 'record#mcp'),
    id: 'op-parent',
    startedAt: NOW,
  };
  const { window } = await openDock(relaunch, [
    opRecord({ id: 'op-child', kind: 'worktreeAdd', module: 'ade', parentId: 'op-parent' }),
    parent,
  ]);
  const child = window.locator('[data-op-id="op-child"]');
  await expect(child).toContainText('Via request_branches');
});
