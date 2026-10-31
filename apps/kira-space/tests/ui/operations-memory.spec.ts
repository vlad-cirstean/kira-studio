import type { ContractJson } from '@workbench/testing/ui/contract';
import { expect, test } from './fixtures';
import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';
import type { ControlSnapshot } from './support/types';

// Memory MCP rows of the Operations dock: the memory-mcp server writes them into op_log and the app
// ingests them. Backend half: memoryflow TestMemoryMcpOps (contract space-ops-memory).

const NOW = '2026-01-01T00:00:00.000Z';

type Records = Record<string, ContractJson>;

function memoryRows(): Records {
  const row = (key: string, id: string): ContractJson => ({
    ...contract<ContractJson>('space-ops-memory', key),
    id,
    startedAt: NOW,
    subject: 'github.com/acme/billing',
  });
  return {
    ok: { ...row('record#ok', 'op-ok'), durationMs: 5 },
    error: { ...row('record#error', 'op-error'), durationMs: 5 },
    running: row('record#running', 'op-running'),
  };
}

async function openDock(
  relaunch: Parameters<Parameters<typeof test>[2]>[0]['relaunch'],
  records: ContractJson[],
) {
  const CONTROL: ControlSnapshot[] = [{ channel: IPC.opsRecent, response: records }];
  const launched = await relaunch({ control: CONTROL });
  await launched.window.click('[data-testid="toggle-operations-panel"]');
  return launched;
}

test('memory rows show the memory module and the MCP tool as source', async ({ relaunch }) => {
  const rows = memoryRows();
  const { window } = await openDock(relaunch, [rows.ok, rows.error]);
  const list = window.locator('[data-testid="op-row"]');
  await expect(list).toHaveCount(2);
  const ok = list.filter({ hasText: 'search_memories' });
  await expect(ok).toContainText('Memory');
  await expect(ok).toContainText('MCP search_memories');
  await expect(ok).toContainText('github.com/acme/billing');
  await expect(ok).toHaveAttribute('data-status', 'ok');
});

test('Copy error on a failed memory call writes its tool text', async ({ relaunch }) => {
  const rows = memoryRows();
  const { window } = await openDock(relaunch, [rows.error]);
  await window.evaluate(() => {
    const w = window as unknown as { __clipboard: string[] };
    w.__clipboard = [];
    navigator.clipboard.writeText = async (text: string) => {
      w.__clipboard.push(text);
    };
  });
  await window.locator('[data-testid="op-row"]').first().click({ button: 'right' });
  await window.getByRole('menuitem', { name: 'Copy error' }).click();
  await expect
    .poll(() => window.evaluate(() => (window as unknown as { __clipboard: string[] }).__clipboard))
    .toEqual([String(rows.error.error)]);
});

test('a running memory call shows its clock, no Cancel, and ends on a pushed update', async ({
  relaunch,
}) => {
  const rows = memoryRows();
  const { window } = await openDock(relaunch, [rows.running]);
  const row = window.locator('[data-testid="op-row"]');
  await expect(row).toHaveAttribute('data-status', 'running');
  await expect(row.locator('[data-testid="op-elapsed"]')).toBeVisible();
  await expect(window.getByRole('button', { name: 'Cancel operation' })).toHaveCount(0);

  await emitWailsEvent(window, IPC.opUpdate, {
    ...rows.running,
    status: 'error',
    durationMs: 800,
    error: 'Memory MCP server stopped while this ran.',
  });
  await expect(row).toHaveAttribute('data-status', 'error');
  await expect(row.locator('[data-testid="op-elapsed"]')).toHaveCount(0);
});
