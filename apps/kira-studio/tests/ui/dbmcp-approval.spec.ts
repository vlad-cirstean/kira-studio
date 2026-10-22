import { emitPrompts, routed } from '@workbench/testing/ui/prompts';
import { expect, test } from './fixtures';
import { contract } from './support/contract';
import { editorText } from './support/editorText';
import { IPC } from './support/ipcChannels';

// Contract dbmcp. Backend half: dbmcpflow TestDbMcpApprovalFlow. A write from an AI client parks on
// the approval dialog; Approve sends that request's id and the snapshot empties.

test('contract: a pending write shows its statement and Approve answers by request id', async ({
  relaunch,
}) => {
  const snap = contract<{ pending: { requestId: string; statement: string } }>(
    'dbmcp',
    'DbMcpService.PendingApprovals',
  );
  const approve = contract<{ requestId: string }>('dbmcp', 'args:DbMcpService.ApproveQuery');
  const { window: page, control } = await relaunch({
    control: [
      {
        channel: IPC.dbMcpPendingApprovals,
        response: { ...snap, pending: { ...snap.pending, expiresAtMs: Date.now() + 60_000 } },
      },
      { channel: IPC.dbMcpApproveQuery, response: { pending: null, queued: 0 } },
    ],
  });

  await emitPrompts(page, [routed('dbmcp', snap.pending.requestId)]);
  const statement = page.locator('[data-testid="db-mcp-approval-statement"]');
  const formatted = await editorText(statement);
  expect(formatted).toContain('\n');
  expect(formatted.replace(/\s+/g, ' ').trim()).toBe(snap.pending.statement);
  await page.click('[data-testid="db-mcp-approval-view-as-sent"]');
  await expect.poll(() => editorText(statement)).toBe(snap.pending.statement);
  const box = await page.locator('[data-testid="db-mcp-approval-dialog"]').boundingBox();
  expect(box?.width).toBeGreaterThan(600);
  await page.click('[data-testid="db-mcp-approval-approve"]');
  await expect
    .poll(() => control.log().find((e) => e.channel === IPC.dbMcpApproveQuery)?.args)
    .toEqual(approve);
});
