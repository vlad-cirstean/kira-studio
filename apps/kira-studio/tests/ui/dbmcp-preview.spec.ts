import { emitPrompts, routed } from '@workbench/testing/ui/prompts';
import { defaultSettings } from '../../frontend/src/state/settingsDomain';
import { expect, test } from './fixtures';
import { contract } from './support/contract';
import { editorText } from './support/editorText';
import { IPC } from './support/ipcChannels';
import { openSettings } from './support/settings';

// Contract dbmcp-preview. Backend half: dbmcpflow TestDbMcpResponsePreview. With the setting on, a
// run_query result that already ran waits in a review dialog; Send releases the held bytes.

interface Snapshot {
  pending: { requestId: string; class: string; target: { database: string } };
  queued: number;
}
interface Held {
  requestId: string;
  text: string;
}
interface Tabular {
  columns: { name: string }[];
  rows: (string | null)[][];
}

const snapshot = () => contract<Snapshot>('dbmcp-preview', 'DbMcpService.PendingApprovals');
const held = () => contract<Held>('dbmcp-preview', 'DbMcpService.PendingResponse');

function mocks(pendingClass?: string) {
  const snap = snapshot();
  return [
    {
      channel: IPC.dbMcpPendingApprovals,
      response: {
        ...snap,
        pending: {
          ...snap.pending,
          class: pendingClass ?? snap.pending.class,
          expiresAtMs: Date.now() + 60_000,
        },
      },
    },
    { channel: IPC.dbMcpPendingResponse, response: held() },
    { channel: IPC.dbMcpApproveQuery, response: { pending: null, queued: 0 } },
    { channel: IPC.dbMcpDenyQuery, response: { pending: null, queued: 0 } },
  ];
}

test('contract: the held result shows as a table and Send answers by request id', async ({
  relaunch,
}) => {
  const snap = snapshot();
  const result = JSON.parse(held().text) as Tabular;
  const approve = contract<{ requestId: string }>(
    'dbmcp-preview',
    'args:DbMcpService.ApproveQuery',
  );
  const { window: page, control } = await relaunch({ control: mocks() });

  await emitPrompts(page, [routed('dbmcp', snap.pending.requestId)]);
  await expect(page.locator('[data-testid="db-mcp-approval-target-database"]')).toHaveText(
    snap.pending.target.database,
  );
  const headers = page.locator('[data-testid="db-mcp-preview-column"]');
  await expect(headers).toHaveText(result.columns.map((c) => c.name));
  const rows = page.locator('[data-testid="db-mcp-preview-row"]');
  await expect(rows).toHaveCount(result.rows.length);
  for (const [i, row] of result.rows.entries()) {
    await expect(rows.nth(i).locator('td')).toHaveText(row.map((cell) => cell ?? 'NULL'));
  }
  await expect(page.locator('[data-testid="db-mcp-preview-ran"]')).toHaveCount(0);

  await page.click('[data-testid="db-mcp-preview-view-as-sent"]');
  await expect
    .poll(() => editorText(page.locator('[data-testid="db-mcp-preview-raw"]')))
    .toBe(held().text);

  await page.click('[data-testid="db-mcp-preview-send"]');
  await expect
    .poll(() => control.log().find((e) => e.channel === IPC.dbMcpApproveQuery)?.args)
    .toEqual(approve);
});

test('contract: Escape withholds the held result', async ({ relaunch }) => {
  const snap = snapshot();
  const { window: page, control } = await relaunch({ control: mocks() });
  await emitPrompts(page, [routed('dbmcp', snap.pending.requestId)]);
  await expect(page.locator('[data-testid="db-mcp-preview-withhold"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect
    .poll(() => control.log().find((e) => e.channel === IPC.dbMcpDenyQuery)?.args)
    .toEqual({ requestId: snap.pending.requestId });
});

test('contract: a write that already ran warns that withholding does not undo it', async ({
  relaunch,
}) => {
  const snap = snapshot();
  const { window: page } = await relaunch({ control: mocks('write') });
  await emitPrompts(page, [routed('dbmcp', snap.pending.requestId)]);
  await expect(page.locator('[data-testid="db-mcp-preview-ran"]')).toBeVisible();
});

test('contract: the preview switch sends the settings patch', async ({ relaunch }) => {
  const args = contract<unknown>('dbmcp-preview', 'args:SettingsService.Set');
  const { window: page, control } = await relaunch({
    control: [
      {
        channel: IPC.settingsSet,
        response: {
          ...defaultSettings,
          dbMcp: { ...defaultSettings.dbMcp, previewResponses: true },
        },
      },
    ],
  });
  await openSettings(page);
  await page.click('[data-testid="settings-section-Database MCP"]');
  await page.click('[data-testid="settings-db-mcp-preview"]');
  await expect
    .poll(() => control.log().find((e) => e.channel === IPC.settingsSet)?.args)
    .toEqual(args);
  await expect(page.locator('[data-testid="settings-db-mcp-preview"]')).toBeChecked();
});
