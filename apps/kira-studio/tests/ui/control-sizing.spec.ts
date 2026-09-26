import type { Locator, Page } from '@playwright/test';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { modeTab, openHttpModeAndNewRequest } from './support/apiMode';
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
// .p-view-head, which moves onto the --kira-bar-h band to close the split fb7476e's bar-height
// family left between it and the now-taller .p-toolbar (F2(c)).

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

// P122: the one shared focus ring (packages/theme/src/base.css's `focus-ring`) -- 1px solid
// --kira-focus, laid inset over the element's own 1px edge, no box-shadow halo. Asserted on the
// actual computed style rather than the class string: the value must render identically whether
// the base `:focus-visible` rule, a `has-[...]:focus-visible:focus-ring` box, or an explicit
// `focus-within:focus-ring` painted it.
async function expectFocusRing(el: Locator): Promise<void> {
  const readStyle = () =>
    el.evaluate((node) => {
      const cs = getComputedStyle(node);
      return {
        outlineStyle: cs.outlineStyle,
        outlineWidth: cs.outlineWidth,
        outlineOffset: cs.outlineOffset,
        outlineColor: cs.outlineColor,
        boxShadow: cs.boxShadow,
      };
    });
  // Every shadcn primitive carries its own transition-colors/transition-all -- which animates
  // outline-width/-color/-offset along with everything else -- so a one-shot read right after
  // focus can catch it mid-transition. Poll past the (150ms default) transition instead of
  // sleeping a fixed amount.
  await expect.poll(async () => (await readStyle()).outlineColor).toBe('rgb(0, 120, 212)');
  const style = await readStyle();
  expect(style.outlineStyle).toBe('solid');
  expect(style.outlineWidth).toBe('1px');
  expect(style.outlineOffset).toBe('-1px');
  expect(style.boxShadow).toBe('none');
}

// Clicks `anchorTestid` (a mouse click, which never itself triggers :focus-visible on a button --
// P122 plan §2.1) when given, then presses Tab until the next tabbable element is `targetTestid`
// -- a real keyboard focus, the only way a button's own :focus-visible rule ever paints. Disabled
// controls in between are skipped by the browser's own native Tab order, so this is robust to
// which of the toolbar's own buttons happen to be enabled in the fixture. `anchorTestid: null`
// starts tabbing from whatever already has focus (e.g. a just-opened dialog's own initial focus).
async function focusViaTabFrom(
  page: Page,
  anchorTestid: string | null,
  targetTestid: string,
  maxTabs = 8,
): Promise<void> {
  if (anchorTestid !== null) {
    await page.locator(`[data-testid="${anchorTestid}"]`).click();
  }
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press('Tab');
    const active = await page.evaluate(
      () => document.activeElement?.getAttribute('data-testid') ?? null,
    );
    if (active === targetTestid) return;
  }
  throw new Error(
    `could not reach [data-testid="${targetTestid}"] via Tab from [data-testid="${anchorTestid}"] within ${maxTabs} presses`,
  );
}

test('every control in the pager toolbar row is one height, equal to --kira-control-h', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: CONTROL, stream: FIXTURE.port });
  await connectAndOpenGrid(page);

  const controlH = await rootVar(page, '--kira-control-h');
  expect(controlH).toBeGreaterThan(0);

  const pageInputHeight = await page
    .locator('[data-testid="pager-page-input"]')
    .evaluate((el) => el.getBoundingClientRect().height);
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

  // P104 §2: settings-font-size is now InputGroupInput's own borderless leaf, nested one level
  // inside the bordered InputGroup box (the stepper recipe's own box-model split) -- the group's
  // own root is what actually renders at --kira-control-h-lg, so that's what this measures.
  // P105 §16: InputGroup's own root is a <fieldset> (implicit role="group"), not a <div>.
  const fontSizeInputHeight = await page
    .locator('[data-testid="settings-font-size"]')
    .locator('xpath=ancestor::fieldset[@data-slot="input-group"][1]')
    .evaluate((el) => el.getBoundingClientRect().height);
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
  const { window: page } = await relaunch({ control: CONTROL, stream: FIXTURE.port });
  await connectAndOpenGrid(page);
  await page.click('[data-testid="open-settings"]');
  await expect(page.locator('[data-testid="settings-dialog"]')).toBeVisible();

  const pInputHeight = await page
    .locator('[data-testid="pager-page-input"]')
    .evaluate((el) => el.getBoundingClientRect().height);
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
  const { window: page } = await relaunch({ control: CONTROL, stream: FIXTURE.port });
  await connectAndOpenGrid(page);

  const barH = await rootVar(page, '--kira-bar-h');
  expect(barH).toBeGreaterThan(0);

  const viewHeadHeight = await page
    .locator('[data-testid="grid-target"]')
    .evaluate((el) => el.closest('[data-testid="view-head"]')?.getBoundingClientRect().height);
  expect(viewHeadHeight).toBeCloseTo(barH, 0);

  const toolbarHeight = await page
    .locator('[data-testid="data-toolbar"]')
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(toolbarHeight).toBeCloseTo(barH, 0);
});

// P117 A1/S5: every pane-switcher ToggleGroup moved to size="kira" so it renders at
// --kira-control-h alongside its bar's other controls, instead of the shorter stock toggle size.
test('the HTTP request pane toggle sits at --kira-control-h (P117 A1)', async ({ relaunch }) => {
  const { window: page } = await relaunch();
  await openHttpModeAndNewRequest(page);
  await expect(page.locator('[data-testid="http-request-view"]')).toBeVisible();

  const controlH = await rootVar(page, '--kira-control-h');
  expect(controlH).toBeGreaterThan(0);

  const height = await page
    .locator('[data-testid="http-request-pane-params"]')
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(height).toBeCloseTo(controlH, 0);
});

// P117 A2: EnvironmentsView's filter InputGroup moved to variant="kira" -- stock rendered at 32px
// under this view's 22px row chrome.
test('the environments filter sits at --kira-control-h, and New environment never clips (P117 A2)', async ({
  relaunch,
}) => {
  const ENVIRONMENTS = [
    { id: 'env-1', name: 'Prod', sortOrder: 0, isActive: true, color: 'green' },
  ];
  const CONTROL: ControlSnapshot[] = [
    { channel: IPC.collectionsList, response: { collections: [], items: [] } },
    { channel: IPC.variablesListEnvironments, response: ENVIRONMENTS },
  ];
  const { window: page } = await relaunch({ control: CONTROL });
  await modeTab(page, 'api').click();
  await page.click('[data-testid="api-environments"]');
  await expect(page.locator('[data-testid="environments-dialog"]')).toBeVisible();

  const controlH = await rootVar(page, '--kira-control-h');
  const filterHeight = await page
    .locator('[data-testid="environments-filter"]')
    .locator('xpath=ancestor::fieldset[@data-slot="input-group"][1]')
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(filterHeight).toBeCloseTo(controlH, 0);

  const newEnvBox = await page.locator('[data-testid="new-environment"]').boundingBox();
  const dialogBox = await page.locator('[data-testid="environments-dialog"]').boundingBox();
  if (newEnvBox === null || dialogBox === null) {
    throw new Error('expected both boxes to be measurable');
  }
  expect(newEnvBox.x + newEnvBox.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width + 1);
});

// P122 §6.2: the reference value itself -- the SQL data view's WHERE filter, `InputGroup
// variant="kira"`'s own `focus-within:focus-ring`. Unchanged by this phase; asserted here as the
// baseline every other row below is measured against.
test('the SQL filter input renders the reference 1px focus ring (P122)', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: CONTROL, stream: FIXTURE.port });
  await connectAndOpenGrid(page);

  await page.click('[data-testid="filter-where-input"]');
  await expectFocusRing(
    page
      .locator('[data-testid="filter-where-input"]')
      .locator('xpath=ancestor::fieldset[@data-slot="input-group"][1]'),
  );
});

// P122 §6.2: stock `Input` (T1) -- used to paint a 3px 50%-alpha box-shadow halo on top of its own
// border; now inherits the shared base `:focus-visible` rule instead.
test('a stock Input renders the shared 1px focus ring, not the old halo (P122)', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: CONTROL, stream: FIXTURE.port });
  await connectAndOpenGrid(page);

  await page.click('[data-testid="pager-page-input"]');
  await expectFocusRing(page.locator('[data-testid="pager-page-input"]'));
});

// P122 §6.2: InputGroup `default` (T3) -- the number-stepper box's own `has-[...]:focus-visible:
// ring-3` halo, now `has-[...]:focus-visible:focus-ring`.
test('the InputGroup default box renders the shared 1px focus ring, not the old halo (P122)', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch();
  await page.click('[data-testid="open-settings"]');
  await expect(page.locator('[data-testid="settings-dialog"]')).toBeVisible();

  await page.click('[data-testid="settings-font-size"]');
  await expectFocusRing(
    page
      .locator('[data-testid="settings-font-size"]')
      .locator('xpath=ancestor::fieldset[@data-slot="input-group"][1]'),
  );
});

// P122 §6.2: `Button` (T4) -- keyboard-focus only (a mouse click never matches :focus-visible on a
// button), the shadcn registry's own ring-3 halo replaced by the shared base rule.
test('a Button renders the shared 1px focus ring on keyboard focus, not the old halo (P122)', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: CONTROL, stream: FIXTURE.port });
  await connectAndOpenGrid(page);

  await focusViaTabFrom(page, 'toolbar-add-row', 'toolbar-search');
  await expectFocusRing(page.locator('[data-testid="toolbar-search"]'));
});

// P122 §6.2/U1: a raw <button> (SettingsShell.vue's own section nav) carried no outline utility at
// all, so it fell back to the browser's own UA focus ring (WebKit: outline: auto 5px
// -webkit-focus-ring-color) -- now painted by the same shared base rule, no template edit needed.
test('a raw <button> with no outline utility renders the shared 1px focus ring (P122)', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch();
  await page.click('[data-testid="open-settings"]');
  await expect(page.locator('[data-testid="settings-dialog"]')).toBeVisible();

  // Reka UI's own dialog auto-focus lands on the content itself, so the first Tab already reaches
  // the section nav's first button -- no anchor to click first.
  await focusViaTabFrom(page, null, 'settings-section-Appearance');
  await expectFocusRing(page.locator('[data-testid="settings-section-Appearance"]'));
});
