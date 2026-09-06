import type { Page } from '@playwright/test';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import {
  ORDER_ITEMS_PATH,
  orderItemsFixture,
  postgresConnectionSummary,
} from './support/postgresFixture';
import { connectionRow, expandRow, findRow, openRowMenu } from './support/tree';

// P22 D2: the row's premise ("the page-number input is visibly taller than the controls beside
// it") is not reproducible from the stylesheet (F3) — every control in the pager's own toolbar
// row already resolves to one height under one box-sizing. This measures that directly rather
// than guess a pixel change against an unmeasured complaint (P16's own D2 correction is exactly
// what guessing produced last time).
//
// P22 D1: the control-role layer (--kira-control-h/-lg/-sm) is a pure alias over the existing
// --kira-h-* scale — every control keeps today's rendered height. The one deliberate exception is
// .p-view-head, which moves onto --kira-viewhead-h (= --kira-bar-h) to close the split fb7476e's
// bar-height family left between it and the now-taller .p-toolbar (F2(c)).

const CONNECTION_ID = 'conn-control-sizing';
const FIXTURE = orderItemsFixture(CONNECTION_ID);
const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Sizing DB', 'blue');

const CONTROL: ControlSnapshot[] = [
  { channel: IPC.connectionsList, response: [] },
  {
    channel: IPC.connectionsCreate,
    args: {
      name: 'Sizing DB',
      kind: 'postgres',
      color: 'blue',
      mode: 'fields',
      readOnly: false,
      host: '127.0.0.1',
      port: 5432,
      database: 'kira_test',
      username: 'postgres',
      password: null,
      uri: null,
      options: {},
      preconnect: null,
      preconnectSidecar: false,
      autoExplain: false,
      throttlePerSec: 0,
    },
    response: CONNECTION_SUMMARY,
  },
  ...FIXTURE.control,
];

async function connectAndOpenGrid(page: Page): Promise<void> {
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', 'Sizing DB');
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '5432');
  await page.fill('[data-testid="connection-database"]', 'kira_test');
  await page.fill('[data-testid="connection-username"]', 'postgres');
  await page.click('[data-testid="color-blue"]');
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  const connRow = connectionRow(page);
  await expect(connRow).toBeVisible();
  await openRowMenu(page, '');
  await page.click('[data-testid="menu-item-connect"]');
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });
  await expandRow(page, '');
  await expandRow(page, 'database:kira_test');
  await expandRow(page, 'database:kira_test/schema:app');

  const row = await findRow(page, ORDER_ITEMS_PATH);
  await row.dblclick();
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
}

function rootVar(page: Page, name: string): Promise<number> {
  return page.evaluate(
    (n) => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n)),
    name,
  );
}

test('every control in the pager toolbar row is one height, equal to --kira-control-h', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: CONTROL });
  await connectAndOpenGrid(page);

  const controlH = await rootVar(page, '--kira-control-h');
  expect(controlH).toBeGreaterThan(0);

  const pageInputHeight = await page
    .locator('[data-testid="pager-page-input"]')
    .evaluate((el) => el.closest('.p-input')?.getBoundingClientRect().height);
  expect(pageInputHeight).toBeCloseTo(controlH, 0);

  for (const testid of ['pager-first', 'pager-prev', 'pager-next', 'pager-last']) {
    const height = await page
      .locator(`[data-testid="${testid}"]`)
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(height).toBeCloseTo(controlH, 0);
  }

  const searchHeight = await page
    .locator('[data-testid="toolbar-search"]')
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(searchHeight).toBeCloseTo(controlH, 0);
});

test('the .md control family in SettingsDialog is one height, equal to --kira-control-h-lg', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch();
  await page.click('[data-testid="open-settings"]');
  await expect(page.locator('[data-testid="settings-dialog"]')).toBeVisible();

  const controlHLg = await rootVar(page, '--kira-control-h-lg');
  expect(controlHLg).toBeGreaterThan(0);

  const fontSizeInputHeight = await page
    .locator('[data-testid="settings-font-size"]')
    .evaluate((el) => el.closest('.p-input')?.getBoundingClientRect().height);
  expect(fontSizeInputHeight).toBeCloseTo(controlHLg, 0);

  const saveHeight = await page
    .locator('[data-testid="settings-save"]')
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(saveHeight).toBeCloseTo(controlHLg, 0);
});

// D1's no-op guard: the role layer is a pure alias, so at the 12px default every family reports
// exactly the pre-P22 value it always has.
test('the role layer changes no rendered control height at the default font size', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: CONTROL });
  await connectAndOpenGrid(page);
  await page.click('[data-testid="open-settings"]');
  await expect(page.locator('[data-testid="settings-dialog"]')).toBeVisible();

  const pInputHeight = await page
    .locator('[data-testid="pager-page-input"]')
    .evaluate((el) => el.closest('.p-input')?.getBoundingClientRect().height);
  expect(pInputHeight).toBeCloseTo(22, 0);

  const pIconbtnHeight = await page
    .locator('[data-testid="pager-first"]')
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(pIconbtnHeight).toBeCloseTo(22, 0);

  const pDlgbtnHeight = await page
    .locator('[data-testid="settings-save"]')
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(pDlgbtnHeight).toBeCloseTo(26, 0);

  const pChipHeight = await page
    .locator('[data-testid="grid-pk-chip"]')
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(pChipHeight).toBeCloseTo(18, 0);
});

// F2(c)/D1: the identity band (.p-view-head, via ViewHeader) and the toolbar directly beneath it
// (.p-toolbar) used to disagree by 6px — every view opened with a 28px band above a 34px bar. D1
// closes the split; both now report --kira-bar-h.
test('the view-head band and the toolbar beneath it report the same height (F2(c) closed)', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: CONTROL });
  await connectAndOpenGrid(page);

  const barH = await rootVar(page, '--kira-bar-h');
  expect(barH).toBeGreaterThan(0);

  const viewHeadHeight = await page
    .locator('[data-testid="grid-target"]')
    .evaluate((el) => el.closest('.p-view-head')?.getBoundingClientRect().height);
  expect(viewHeadHeight).toBeCloseTo(barH, 0);

  const toolbarHeight = await page
    .locator('[data-testid="data-toolbar"]')
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(toolbarHeight).toBeCloseTo(barH, 0);
});
