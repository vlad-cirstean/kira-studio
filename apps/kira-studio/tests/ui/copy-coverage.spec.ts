import type { Page } from '@playwright/test';
import {
  expectCatalogText,
  setPseudoLocale,
} from '../../../../packages/workbench/src/testing/ui/copyCoverage';
import { expect, test } from './fixtures';
import { modeTab, openHttpModeAndNewRequest } from './support/apiMode';
import { contract } from './support/contract';
import {
  connectPostgres,
  openCompositeTable,
  openContextMenu,
  PG_ALLOW,
  PG_CONTROL,
  PG_PORT,
} from './support/copyScenarios';
import { cellText, gridCell, gutterCell, headerCell } from './support/grid';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';
import { COMPOSITE_PK_PATH } from './support/postgresFixture';
import { emitPrompts, routed } from './support/prompts';
import { openSettings } from './support/settings';
import { openRowMenu } from './support/tree';

// P265: with the pseudo-locale on, every catalog message shows wrapped in ⟦…⟧, so any letter
// outside a marker is a literal that skipped t(). Fixture names and section ids that the shared
// SettingsShell prints raw go through `allow`. Surfaces needing heavy fixtures (saved queries
// menu, explain result, definition view, documents, key-value, stream, gRPC) are not covered here.

const ALLOW: RegExp[] = [...PG_ALLOW, /^(Api|Database MCP)$/];
const loc = (page: Page, testid: string) => page.locator(`[data-testid="${testid}"]`);

async function pseudo(page: Page): Promise<void> {
  await setPseudoLocale(page);
}

test('title bar, mode switcher and status bar', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [{ channel: IPC.connectionsList, response: [] }],
  });
  await pseudo(page);
  await expectCatalogText(page.locator('.h-titlebar'), { allow: ALLOW });
  await expectCatalogText(page.locator('[data-testid="mode-tab"]'), { allow: ALLOW });
  await expectCatalogText(loc(page, 'status-bar'), { allow: ALLOW });
});

test('project panel header and empty state', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [{ channel: IPC.connectionsList, response: [] }],
  });
  await pseudo(page);
  await expectCatalogText(loc(page, 'project-panel'), { allow: ALLOW });
});

test('connection row menu', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: PG_CONTROL, stream: PG_PORT });
  await pseudo(page);
  await openRowMenu(page, '');
  await expectCatalogText(loc(page, 'context-menu'), { allow: ALLOW });
});

test('connection dialog, every tab', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [{ channel: IPC.connectionsList, response: [] }],
  });
  await pseudo(page);
  await page.click('[data-testid="add-connection"]');
  const dialog = loc(page, 'connection-dialog');
  await expect(dialog).toBeVisible();
  await expectCatalogText(dialog, { allow: ALLOW });
  await page.click('[data-testid="connection-kind-postgres"]');
  for (const tab of ['general', 'advanced', 'preconnect', 'mcp']) {
    await loc(page, `connection-tab-${tab}`).click();
    await expectCatalogText(dialog, { allow: ALLOW });
  }
});

test('settings dialog, every pane', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: [] });
  await pseudo(page);
  await openSettings(page);
  for (const section of ['Appearance', 'Data', 'Cache', 'Api', 'Database MCP', 'Advanced']) {
    await loc(page, `settings-section-${section}`).click();
    await expectCatalogText(loc(page, 'settings-dialog'), { allow: ALLOW });
  }
});

test('data view toolbar, column menu, cell menu and cell editor dock', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: PG_CONTROL, stream: PG_PORT });
  await pseudo(page);
  await openCompositeTable(page);
  await expectCatalogText(loc(page, 'data-toolbar'), { allow: ALLOW });

  await openContextMenu(headerCell(page, 'name'));
  await expectCatalogText(loc(page, 'context-menu'), { allow: ALLOW });
  await page.keyboard.press('Escape');

  await openContextMenu(gridCell(page, 0, 'name'));
  await expectCatalogText(loc(page, 'context-menu'), { allow: ALLOW });
  await page.keyboard.press('Escape');

  await openContextMenu(gutterCell(page, 0));
  await expectCatalogText(loc(page, 'context-menu'), { allow: ALLOW });
  await page.keyboard.press('Escape');

  await gridCell(page, 0, 'name').click();
  expect(await cellText(page, 0, 'name')).not.toBe('');
  await expectCatalogText(loc(page, 'cell-editor'), { allow: ALLOW });
});

test('generate data dialog', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: PG_CONTROL, stream: PG_PORT });
  await pseudo(page);
  await openCompositeTable(page);
  await page.click('[data-testid="toolbar-generate-data"]');
  const dialog = loc(page, 'generate-data-dialog');
  await expect(dialog).toBeVisible();
  await expectCatalogText(dialog, { allow: ALLOW });
});

test('console toolbar', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: PG_CONTROL, stream: PG_PORT });
  await pseudo(page);
  await connectPostgres(page);
  await openRowMenu(page, COMPOSITE_PK_PATH);
  await page.click('[data-testid="menu-item-open-console"]');
  await expect(loc(page, 'console-view')).toBeVisible();
  await expectCatalogText(loc(page, 'console-view'), { allow: ALLOW });
});

test('command palette', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: [] });
  await pseudo(page);
  await emitWailsEvent(page, IPC.commandPalette, null);
  await expect(loc(page, 'command-palette-input')).toBeVisible();
  await expectCatalogText(page.locator('[data-slot="dialog-content"]'), { allow: ALLOW });
});

test('operations panel', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: [] });
  await pseudo(page);
  await page.click('[data-testid="toggle-operations-panel"]');
  await expect(loc(page, 'operations-panel')).toBeVisible();
  await expectCatalogText(loc(page, 'operations-panel'), { allow: ALLOW });
});

test('DB MCP approval dialog', async ({ relaunch }) => {
  const snap = contract<{ pending: { requestId: string; statement: string } }>(
    'dbmcp',
    'DbMcpService.PendingApprovals',
  );
  const { window: page } = await relaunch({
    control: [
      {
        channel: IPC.dbMcpPendingApprovals,
        response: { ...snap, pending: { ...snap.pending, expiresAtMs: Date.now() + 60_000 } },
      },
    ],
  });
  await pseudo(page);
  await emitPrompts(page, [routed('dbmcp', snap.pending.requestId)]);
  const dialog = loc(page, 'db-mcp-approval-dialog');
  await expect(dialog).toBeVisible();
  await expectCatalogText(dialog, {
    allow: [
      ...ALLOW,
      new RegExp(snap.pending.statement.slice(0, 10).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    ],
  });
});

test('HTTP request view, every tab, empty response', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: [] });
  await pseudo(page);
  await openHttpModeAndNewRequest(page);
  await expectCatalogText(loc(page, 'http-request-view'), { allow: ALLOW });
  for (const pane of ['params', 'headers', 'body', 'settings', 'cookies']) {
    await loc(page, `http-request-pane-${pane}`).click();
    await expectCatalogText(loc(page, 'http-request-view'), { allow: ALLOW });
  }
});

test('collections panel empty state', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [{ channel: IPC.collectionsList, response: { collections: [], items: [] } }],
  });
  await pseudo(page);
  await modeTab(page, 'api').click();
  await expect(loc(page, 'collections-empty')).toBeVisible();
  await expectCatalogText(loc(page, 'project-panel'), { allow: ALLOW });
});

test('environments view', async ({ relaunch }) => {
  const { window: page } = await relaunch({
    control: [{ channel: IPC.collectionsList, response: { collections: [], items: [] } }],
  });
  await pseudo(page);
  await modeTab(page, 'api').click();
  await page.click('[data-testid="api-environments"]');
  await expect(loc(page, 'environments-dialog')).toBeVisible();
  await expectCatalogText(loc(page, 'environments-dialog'), { allow: ALLOW });
});
