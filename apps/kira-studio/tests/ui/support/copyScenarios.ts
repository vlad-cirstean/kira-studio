import { expect, type Locator, type Page } from '@playwright/test';
import type { ControlSnapshot, PortSnapshot } from '../../ipc/support/types';
import { IPC } from './ipcChannels';
import {
  APP_PATH,
  COMPOSITE_PK_PATH,
  compositePkConnectAndOpen,
  DB_PATH,
  postgresConnectionSummary,
} from './postgresFixture';
import { connectionRow, expandRow, findRow, openRowMenu } from './tree';

// Shared by copy-wording.spec.ts and copy-coverage.spec.ts: one connected Postgres connection with
// app.composite_pk's three rows, so both specs reach the same grid and menus.

export const PG_CONN = postgresConnectionSummary('conn-copy', 'Copy DB', 'blue');
const FIXTURE = compositePkConnectAndOpen(PG_CONN.id);

export const PG_CONTROL: ControlSnapshot[] = [
  { channel: IPC.connectionsList, response: [PG_CONN] },
  ...FIXTURE.control,
];
export const PG_PORT: PortSnapshot[] = FIXTURE.port;

/** Fixture data that legitimately shows without a catalog marker. */
export const PG_ALLOW: RegExp[] = [
  /Copy DB/,
  /kira_test/,
  /composite_pk/,
  /tenant|entity|postgres|127\.0\.0\.1/i,
];

export async function connectPostgres(page: Page): Promise<void> {
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(connectionRow(page).locator('.status-dot')).toHaveAttribute(
    'data-status',
    'connected',
    { timeout: 10_000 },
  );
  await expandRow(page, '');
  await expandRow(page, DB_PATH);
  await expandRow(page, APP_PATH);
}

export async function openCompositeTable(page: Page): Promise<void> {
  await connectPostgres(page);
  await (await findRow(page, COMPOSITE_PK_PATH)).dblclick();
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
}

/** Right-clicks and waits for the menu to stay open; SlickGrid can re-render under the click. */
export async function openContextMenu(target: Locator): Promise<Locator> {
  const page = target.page();
  const menu = page.locator('[data-testid="context-menu"]');
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await target.scrollIntoViewIfNeeded();
      await target.click({ button: 'right' });
      await expect(menu).toBeVisible();
      await page.waitForTimeout(300);
      if (await menu.isVisible()) return menu;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
  await expect(menu).toBeVisible();
  return menu;
}

/** Visible item labels of the open context menu, in order. */
export async function menuLabels(page: Page): Promise<string[]> {
  return page
    .locator(
      '[data-testid="context-menu"] [data-testid^="menu-item-"]:not([data-testid$="-shortcut"])',
    )
    .evaluateAll((els) =>
      els.map((el) => (el.querySelector('.flex-1') ?? el).textContent?.trim() ?? ''),
    );
}
