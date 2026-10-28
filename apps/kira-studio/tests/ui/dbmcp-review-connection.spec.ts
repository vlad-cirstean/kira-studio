import type { ConnectionSummary } from '@shared/domain/connection';
import { emitPrompts, routed } from '@workbench/testing/ui/prompts';
import { expect, test } from './fixtures';
import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';
import { openSettings } from './support/settings';
import { connectionRow } from './support/tree';

// Contract dbmcp-review-connection. Backend half: dbmcpflow TestDbMcpReviewPerConnection. A
// connection's review setting overrides the app switch: its results are held with the app switch off.

interface Snapshot {
  pending: { requestId: string; target: { database: string } };
  queued: number;
}
interface UpdateArgs {
  id: string;
  input: Record<string, unknown>;
}

const ID = 'conn-review';
const OTHER_ID = 'conn-inherit';

const updated = () =>
  contract<ConnectionSummary>('dbmcp-review-connection', 'ConnectionsService.Update');
const updateArgs = () =>
  contract<UpdateArgs>('dbmcp-review-connection', 'args:ConnectionsService.Update');

const inheriting = (): ConnectionSummary => ({
  ...updated(),
  id: ID,
  mcpReviewResults: 'inherit',
  sortOrder: 0,
});
const other = (): ConnectionSummary => ({
  ...inheriting(),
  id: OTHER_ID,
  name: 'Plain DB',
  sortOrder: 1,
});

test('contract: picking Always in the MCP tab saves the review setting', async ({ relaunch }) => {
  const saved = { ...updated(), id: ID };
  const { window: page, control } = await relaunch({
    control: [
      { channel: IPC.connectionsList, response: [inheriting()] },
      { channel: IPC.connectionsUpdate, response: saved },
    ],
  });
  await (await connectionRow(page, updated().name)).click({ button: 'right' });
  await page.click('[data-testid="menu-item-edit"]');
  await page.click('[data-testid="connection-tab-mcp"]');

  await expect(page.locator('[data-testid="connection-mcp-review-inherit"]')).toHaveAttribute(
    'data-state',
    'on',
  );
  await expect(page.locator('[data-testid="connection-mcp-review-inherit"]')).toHaveText(
    'App setting (off)',
  );
  await page.click('[data-testid="connection-mcp-review-review"]');
  await page.click('[data-testid="connection-save"]');

  await expect
    .poll(() => control.log().find((e) => e.channel === IPC.connectionsUpdate)?.args)
    .toEqual({ ...updateArgs(), id: ID });
});

test('the settings glance flags a connection with an override and skips one that inherits', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [
      {
        channel: IPC.connectionsList,
        response: [{ ...inheriting(), mcpReviewResults: 'review' }, other()],
      },
    ],
  });
  await openSettings(page);
  await page.click('[data-testid="settings-section-Database MCP"]');
  await expect(page.locator(`[data-testid="db-mcp-connection-review-${ID}"]`)).toHaveText(
    'Results always reviewed',
  );
  await expect(page.locator(`[data-testid="db-mcp-connection-review-${OTHER_ID}"]`)).toHaveCount(0);
});

test('contract: a result held by a connection override opens the review dialog', async ({
  relaunch,
}) => {
  const snap = contract<Snapshot>('dbmcp-review-connection', 'DbMcpService.PendingApprovals');
  const held = contract<{ requestId: string }>(
    'dbmcp-review-connection',
    'DbMcpService.PendingResponse',
  );
  const { window: page, control } = await relaunch({
    control: [
      {
        channel: IPC.dbMcpPendingApprovals,
        response: { ...snap, pending: { ...snap.pending, expiresAtMs: Date.now() + 60_000 } },
      },
      { channel: IPC.dbMcpPendingResponse, response: held },
      { channel: IPC.dbMcpApproveQuery, response: { pending: null, queued: 0 } },
    ],
  });
  await emitPrompts(page, [routed('dbmcp', snap.pending.requestId)]);
  await expect(page.locator('[data-testid="db-mcp-preview-send"]')).toBeVisible();
  await page.click('[data-testid="db-mcp-preview-send"]');
  await expect
    .poll(() => control.log().find((e) => e.channel === IPC.dbMcpApproveQuery)?.args)
    .toEqual({ requestId: snap.pending.requestId });
});
