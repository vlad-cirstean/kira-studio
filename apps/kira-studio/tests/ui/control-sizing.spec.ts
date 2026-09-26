import type { Locator, Page } from '@playwright/test';
import { DATA_OP } from '@shared/protocol/data-ops';
import type { ColumnDescriptor } from '@shared/protocol/page';
import type { ControlSnapshot, LogicalPage, PortSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { modeTab, openHttpModeAndNewRequest } from './support/apiMode';
import { connectAndExpand, connectionCreateArgs, openConsoleFromMenu } from './support/connect';
import { typeInto } from './support/editor';
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

// P121 §6.2: a default-variant ToggleGroup is no longer connected (spacing 0.5, not 0) -- every
// item keeps its own full 4px radius on all four corners, 2px apart, instead of rendering as one
// square-cornered connected segment row.
test('the page-size ToggleGroup renders rounded, 2px-spaced chips (P121 S23)', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: CONTROL, stream: FIXTURE.port });
  await connectAndOpenGrid(page);

  const items = [
    page.locator('[data-testid="page-size-10"]'),
    page.locator('[data-testid="page-size-100"]'),
    page.locator('[data-testid="page-size-1000"]'),
    page.locator('[data-testid="page-size-10000"]'),
  ];
  for (const item of items) {
    expect(await item.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('4px');
  }
  const [firstBox, secondBox] = await Promise.all([items[0].boundingBox(), items[1].boundingBox()]);
  if (!firstBox || !secondBox) throw new Error('expected both page-size chips to be measurable');
  expect(secondBox.x - (firstBox.x + firstBox.width)).toBeCloseTo(2, 0);
});

// P121 §6.2: same shape as S23, a different default-variant ToggleGroup (P117 A1's own "kira"
// size, unaffected by this phase's height/font work -- only radius/spacing changed).
test('the HTTP request pane toggle items are rounded, at 22px (P121 S14)', async ({ relaunch }) => {
  const { window: page } = await relaunch();
  await openHttpModeAndNewRequest(page);
  await expect(page.locator('[data-testid="http-request-view"]')).toBeVisible();

  for (const testid of [
    'http-request-pane-params',
    'http-request-pane-headers',
    'http-request-pane-body',
    'http-request-pane-settings',
    'http-request-pane-cookies',
  ]) {
    const item = page.locator(`[data-testid="${testid}"]`);
    const style = await item.evaluate((el) => ({
      radius: getComputedStyle(el).borderRadius,
      height: el.getBoundingClientRect().height,
    }));
    expect(style.radius).toBe('4px');
    expect(style.height).toBeCloseTo(22, 0);
  }
});

// P121 §6.2: the row-density ToggleGroup is `variant="outline"`, so it stays connected (spacing 0,
// the K1 KuiSegmented precedent) -- only its two outer corners round, and the shared inner edge
// keeps a single 1px divider (the second/last item's own border-left drops to 0, rather than
// doubling the first item's border-right).
test('the row-density ToggleGroup keeps a connected outline with 4px outer corners (P121 S4)', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch();
  await page.click('[data-testid="open-settings"]');
  await expect(page.locator('[data-testid="settings-dialog"]')).toBeVisible();

  const compact = page.locator('[data-testid="settings-appearance-rowDensity-compact"]');
  const comfortable = page.locator('[data-testid="settings-appearance-rowDensity-comfortable"]');

  const compactRadii = await compact.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { tl: cs.borderTopLeftRadius, tr: cs.borderTopRightRadius };
  });
  expect(compactRadii.tl).toBe('4px');
  expect(compactRadii.tr).toBe('0px');

  const comfortableRadii = await comfortable.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { tl: cs.borderTopLeftRadius, tr: cs.borderTopRightRadius };
  });
  expect(comfortableRadii.tl).toBe('0px');
  expect(comfortableRadii.tr).toBe('4px');

  expect(await comfortable.evaluate((el) => getComputedStyle(el).borderLeftWidth)).toBe('0px');
});

// P121 §6.2: the mode Fields/URI toggle (S5) and the MCP read/write/DDL toggles (S6) moved to
// `size="kira-lg"` -- dialog density, matching this dialog's own 26px inputs and kira-lg buttons.
test('connection dialog toggles render at dialog density, 26px/11px (P121 S5, S6)', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [{ channel: IPC.connectionsList, response: [] }],
  });
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');

  const modeItem = page.locator('[data-testid="mode-fields"]');
  const modeStyle = await modeItem.evaluate((el) => ({
    height: el.getBoundingClientRect().height,
    fontSize: getComputedStyle(el).fontSize,
  }));
  expect(modeStyle.height).toBeCloseTo(26, 0);
  expect(modeStyle.fontSize).toBe('11px');

  await page.click('[data-testid="connection-tab-mcp"]');
  await page.click('[data-testid="connection-mcp-enabled"]');
  const readItem = page.locator('[data-testid="connection-mcp-read-allow"]');
  const readStyle = await readItem.evaluate((el) => ({
    height: el.getBoundingClientRect().height,
    fontSize: getComputedStyle(el).fontSize,
  }));
  expect(readStyle.height).toBeCloseTo(26, 0);
  expect(readStyle.fontSize).toBe('11px');
});

// P121 §6.2: the connection detail tabs (T5), now shadcn `Tabs` -- gained a hover state, the
// tab-strip's own 2px chip gap (was 4px), and arrow-key roving focus (was a hand-rolled
// `role="tab"` with none).
test('connection detail tabs: hover, 2px gap, and arrow-key roving focus (P121 T5)', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({
    control: [{ channel: IPC.connectionsList, response: [] }],
  });
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');

  const general = page.locator('[data-testid="connection-tab-general"]');
  const advanced = page.locator('[data-testid="connection-tab-advanced"]');

  const before = await advanced.evaluate((el) => getComputedStyle(el).backgroundColor);
  await advanced.hover();
  await expect
    .poll(() => advanced.evaluate((el) => getComputedStyle(el).backgroundColor))
    .not.toBe(before);
  await page.mouse.move(0, 0); // clears the hover before the gap/geometry read below

  const [generalBox, advancedBox] = await Promise.all([
    general.boundingBox(),
    advanced.boundingBox(),
  ]);
  if (!generalBox || !advancedBox) throw new Error('expected both tabs to be measurable');
  expect(advancedBox.x - (generalBox.x + generalBox.width)).toBeCloseTo(2, 0);

  await general.focus();
  await page.keyboard.press('ArrowRight');
  await expect(advanced).toHaveClass(/is-active/);
});

function intColumnPage(column: string, values: string[]): LogicalPage {
  const columns: ColumnDescriptor[] = [
    {
      name: column,
      dataType: 'int4',
      typeClass: 'number',
      nullable: true,
      isPrimaryKey: false,
      generated: false,
    },
  ];
  return {
    kind: 'tabular',
    columns,
    rows: values.map((v) => [v]),
    position: {
      offset: 0,
      pageSize: values.length,
      hasMore: false,
      nextToken: null,
      prevToken: null,
      strategy: 'offset',
    },
    truncatedCells: 0,
  };
}

function numberPage(column: string, value: string): LogicalPage {
  return intColumnPage(column, [value]);
}

function executeSnap(
  connectionId: string,
  statements: string[],
  pages: LogicalPage[],
): PortSnapshot {
  return {
    op: DATA_OP.execute,
    payload: { connectionId, path: ORDER_ITEMS_PATH, statements },
    response: { kind: 'execute', pages },
  };
}

// P121 §6.2: the console's own result chips ("Result 1", "Result 2") were the one tab-chip copy
// off the shared scale (22px/10px, a 4px strip gap) -- now tab-strip size (T1's own 26px/11px/2px).
test('console result tabs render at tab-strip size, 2px strip gap (P121 T4)', async ({
  relaunch,
}) => {
  const CONNECTION_ID = 'conn-p121-console';
  const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Console Sizing DB', 'blue');
  const CONSOLE_FIXTURE = orderItemsFixture(CONNECTION_ID);
  const CONSOLE_CONTROL: ControlSnapshot[] = [
    { channel: IPC.connectionsList, response: [] },
    {
      channel: IPC.connectionsCreate,
      args: connectionCreateArgs('Console Sizing DB', 'blue'),
      response: CONNECTION_SUMMARY,
    },
    ...CONSOLE_FIXTURE.control,
  ];
  const CONSOLE_PORT: PortSnapshot[] = [
    ...CONSOLE_FIXTURE.port,
    executeSnap(CONNECTION_ID, ['SELECT 1 AS n'], [numberPage('n', '1')]),
    executeSnap(CONNECTION_ID, ['SELECT 2 AS n'], [numberPage('n', '2')]),
  ];

  const { window: page } = await relaunch({ control: CONSOLE_CONTROL, stream: CONSOLE_PORT });
  await connectAndExpand(page, 'Console Sizing DB', 'blue');
  await openConsoleFromMenu(page, ORDER_ITEMS_PATH);

  const consoleView = page.locator('[data-testid="console-view"]');
  await typeInto(consoleView, page, 'SELECT 1 AS n;');
  await page.click('[data-testid="console-run-statement"]');
  await expect(consoleView.locator('[data-testid="console-result-tab"]')).toHaveCount(1);

  await typeInto(consoleView, page, '\nSELECT 2 AS n;');
  await page.click('[data-testid="console-run-statement"]');
  const resultTabs = consoleView.locator('[data-testid="console-result-tab"]');
  await expect(resultTabs).toHaveCount(2);

  const style = await resultTabs.nth(0).evaluate((el) => ({
    height: el.getBoundingClientRect().height,
    fontSize: getComputedStyle(el).fontSize,
  }));
  expect(style.height).toBeCloseTo(26, 0);
  expect(style.fontSize).toBe('11px');

  const [firstBox, secondBox] = await Promise.all([
    resultTabs.nth(0).boundingBox(),
    resultTabs.nth(1).boundingBox(),
  ]);
  if (!firstBox || !secondBox) throw new Error('expected both result tabs to be measurable');
  expect(secondBox.x - (firstBox.x + firstBox.width)).toBeCloseTo(2, 0);
});

// P121 §6.2: T1's own `pt-0.5` removal -- the scrolling tab now centres in its 34px `h-tabbar`
// bar (`tab-strip`, minus its own 1px `border-b`) instead of sitting 2px low.
test('the first document tab sits vertically centred in the tab-strip bar (P121 T1)', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: CONTROL, stream: FIXTURE.port });
  await connectAndOpenGrid(page);

  const bar = page.locator('[data-testid="tab-strip"]');
  const firstTab = page.locator('[data-testid="tab-strip-row"] [data-testid="tab"]').first();

  const [barBox, tabBox] = await Promise.all([bar.boundingBox(), firstTab.boundingBox()]);
  if (!barBox || !tabBox)
    throw new Error('expected both the bar and its first tab to be measurable');

  const barBottomInterior = barBox.y + barBox.height - 1; // 1px border-b
  const topGap = tabBox.y - barBox.y;
  const bottomGap = barBottomInterior - (tabBox.y + tabBox.height);
  expect(Math.abs(topGap - bottomGap)).toBeLessThanOrEqual(0.5);
});
