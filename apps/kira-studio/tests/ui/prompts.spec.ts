import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';
import { emitPrompts, routed } from './support/prompts';

// P246: the window shows the popup the Go router targeted at it, one at a time. The Go half is
// flows/promptflow; here the router's pushes are mocked.

const approval = (requestId: string) => ({
  requestId,
  connectionId: 'c1',
  connectionName: 'Prod',
  kind: 'postgres',
  class: 'write',
  statement: 'DELETE FROM t',
  expiresAtMs: Date.now() + 60_000,
  reason: 'permission',
  plan: null,
});

const UPDATE = {
  channel: IPC.updateStatus,
  response: {
    updateAvailable: true,
    currentVersion: '1.2.0',
    latestVersion: '1.3.0',
    installLogPath: '/tmp/kira-studio-update.log',
  },
} as const;

test('an MCP approval shows only in the window the router targets', async ({ kira }) => {
  const { window } = kira;
  const dialog = window.locator('[data-testid="db-mcp-approval-dialog"]');
  await emitWailsEvent(window, IPC.dbMcpApproval, { pending: approval('req-1'), queued: 1 });

  await emitPrompts(window, [routed('dbmcp', 'req-1', { target: 'other-window' })]);
  await expect(dialog).toHaveCount(0);
  await emitPrompts(window, [routed('dbmcp', 'req-1')]);
  await expect(dialog).toBeVisible();
  await emitPrompts(window, []);
  await expect(dialog).toHaveCount(0);
});

test('the oldest prompt shows first with a count; a reveal push shows another', async ({
  relaunch,
}) => {
  const { window } = await relaunch({ control: [UPDATE] });
  const approvalDialog = window.locator('[data-testid="db-mcp-approval-dialog"]');
  const updateDialog = window.locator('[data-testid="update-dialog"]');
  await emitWailsEvent(window, IPC.dbMcpApproval, { pending: approval('req-1'), queued: 1 });
  await emitPrompts(window, [
    routed('dbmcp', 'req-1', { createdAt: 1 }),
    routed('update', '1.3.0', { createdAt: 2 }),
  ]);

  await expect(approvalDialog).toBeVisible();
  await expect(window.locator('[data-testid="db-mcp-approval-queue-count"]')).toHaveText(
    '1 more waiting',
  );
  await expect(updateDialog).toHaveCount(0);

  await emitWailsEvent(window, IPC.promptsReveal, { id: 'update:1.3.0' });
  await expect(updateDialog).toBeVisible();
  await expect(approvalDialog).toHaveCount(0);
});

test('Send test notification calls the bound method', async ({ kira }) => {
  const { window, control } = kira;
  await emitWailsEvent(window, IPC.openSettings, undefined);
  await window.locator('[data-testid="settings-section-Advanced"]').click();
  await expect(window.locator('[data-testid="settings-notify-prompts"]')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await window.locator('[data-testid="settings-notify-prompts-test"]').click();
  await expect.poll(() => control.log().some((e) => e.channel === IPC.promptsSendTest)).toBe(true);
});
