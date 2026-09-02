import type { Locator, Page } from '@playwright/test';
import type { ControlSnapshot, PortSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import {
  COMPOSITE_PK_PATH,
  compositePkConnectAndOpen,
  postgresConnectionSummary,
} from './support/postgresFixture';
import { connectionRow, expandRow, findRow, openRowMenu } from './support/tree';

// Ported from tests/e2e/tooltips.spec.ts (P57 D16), against the same real-captured
// app.composite_pk fixture mutations.spec.ts uses (a genuine PK, no inbound FK — here it's the PK
// checkbox in ColumnsMenu that scenario 3 needs). The original's own `beforeAll`/`afterAll` and
// `test.describe.configure({ timeout: 300_000 })` existed only to stand up and tear down a real
// Docker Postgres container — nothing to port, there is no container in this tier. Its
// `createConnection` helper was a raw `page.evaluate(() => window.kira.connectionsCreate(...))`
// call, the pre-migration escape hatch — `window.kira` no longer exists post-M2/M3 (AGENTS.md's
// P57 finding), so both connections here are created through the real dialog instead, the same
// flow mutations.spec.ts's own read-only-connection scenario already uses. Everything else is one
// continuous session with no relaunch(), so it all ports unchanged: the app-owned tooltip
// mechanism itself (workbench/state/tooltip.ts + AppTooltip.vue) is exactly this spec's subject,
// hit-testing a disabled control (scenario 2, F5/D3 — Blink dispatches no pointer events on one)
// and a control inside an already-open popover (scenario 3, F3(a) — the popover's own backdrop
// must not swallow the hit test).

const DB_PATH = 'database:kira_test';
const APP_PATH = `${DB_PATH}/schema:app`;

const CONNECTION_ID = 'conn-tooltips';
const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Tooltips DB', 'blue');
const FIXTURE = compositePkConnectAndOpen(CONNECTION_ID);

const RO_CONNECTION_ID = 'conn-tooltips-ro';
const RO_CONNECTION_SUMMARY = {
  ...postgresConnectionSummary(RO_CONNECTION_ID, 'Tooltips DB (RO)', 'red'),
  readOnly: true,
};
const RO_FIXTURE = compositePkConnectAndOpen(RO_CONNECTION_ID);

const CONTROL: ControlSnapshot[] = [
  { channel: IPC.connectionsList, response: [] },
  {
    channel: IPC.connectionsCreate,
    args: {
      name: 'Tooltips DB',
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
    },
    response: CONNECTION_SUMMARY,
  },
  ...FIXTURE.control,
  {
    channel: IPC.connectionsCreate,
    args: {
      name: 'Tooltips DB (RO)',
      kind: 'postgres',
      color: 'red',
      mode: 'fields',
      readOnly: true,
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
    },
    response: RO_CONNECTION_SUMMARY,
  },
  ...RO_FIXTURE.control,
];

const PORT: PortSnapshot[] = [...FIXTURE.port, ...RO_FIXTURE.port];

const tooltip = (page: Page): Locator => page.locator('[data-testid="app-tooltip"]');

/** Hovers `trigger` and asserts the app tooltip becomes visible with `text`, well within the
 *  400 ms open delay (TOOLTIP_DELAY_MS). Scenario 1 below additionally checks the "before" side
 *  of that delay; the other scenarios only care that it eventually shows the right thing. */
async function assertTooltipShows(
  page: Page,
  trigger: Locator,
  text: string | RegExp,
): Promise<void> {
  await trigger.hover();
  await expect(tooltip(page)).toBeVisible({ timeout: 1_000 });
  await expect(tooltip(page)).toHaveText(text);
}

test('tooltips — app-owned surface: delay, disabled controls, popovers, a11y', async ({
  relaunch,
  consoleErrors,
}) => {
  const { window: page } = await relaunch({ control: CONTROL, stream: PORT });

  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', 'Tooltips DB');
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
  await expandRow(page, DB_PATH);
  await expandRow(page, APP_PATH);
  await (await findRow(page, COMPOSITE_PK_PATH)).dblclick();
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();

  // --- scenario 1: an enabled control — hidden before the delay, shown after, hides on leave ---
  // A cold hover, not a scan: settle the pointer away from the tree first and outlast
  // TOOLTIP_REARM_MS (state/tooltip.ts's D6), or this hover lands in the rearm window left by the
  // dblclick above and opens immediately instead of waiting the full TOOLTIP_DELAY_MS.
  await page.mouse.move(4, 4);
  await page.waitForTimeout(350);
  const refreshButton = page.locator('[data-testid="toolbar-refresh"]');
  await refreshButton.hover();
  await page.waitForTimeout(150);
  await expect(tooltip(page)).toHaveCount(0);
  await expect(tooltip(page)).toBeVisible({ timeout: 1_000 });
  await expect(tooltip(page)).toHaveText('Refresh');

  await page.mouse.move(4, 4);
  await page.waitForTimeout(100);
  await expect(tooltip(page)).toHaveCount(0);

  // --- scenario 3: over an overlay — a popover's own backdrop must not swallow the hit test ---
  // (F3(a)). ColumnsMenu's PK checkbox carries a hint only when it's the locked one.
  await page.click('[data-testid="toolbar-columns"]');
  await expect(page.locator('[data-testid="columns-menu"]')).toBeVisible();
  const pkCheckbox = page.locator('.columns-menu-item.is-pk input[type="checkbox"]').first();
  await expect(pkCheckbox).toBeVisible();
  await assertTooltipShows(page, pkCheckbox, /Primary key — always shown/);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="columns-menu"]')).toHaveCount(0);

  // --- scenario 2: a disabled control (F5/D3) — a naive mouseenter implementation never sees
  // this hover at all, since Blink dispatches no pointer events on a disabled form control.
  await connRow.locator('.twisty').click(); // collapse — keeps the two connections' tree paths distinct
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', 'Tooltips DB (RO)');
  await page.fill('[data-testid="connection-host"]', '127.0.0.1');
  await page.fill('[data-testid="connection-port"]', '5432');
  await page.fill('[data-testid="connection-database"]', 'kira_test');
  await page.fill('[data-testid="connection-username"]', 'postgres');
  await page.click('[data-testid="color-red"]');
  await page.click('[data-testid="connection-readonly"]');
  await page.click('[data-testid="connection-save"]');
  await expect(page.locator('[data-testid="connection-dialog"]')).toHaveCount(0);

  const roConnRow = connectionRow(page, 'Tooltips DB (RO)');
  await expect(roConnRow).toBeVisible();
  await roConnRow.click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await page.click('[data-testid="menu-item-connect"]');
  await expect(roConnRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });
  await roConnRow.locator('.twisty').click();
  await expandRow(page, DB_PATH);
  await expandRow(page, APP_PATH);
  await (await findRow(page, COMPOSITE_PK_PATH)).dblclick();
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();

  const addRowButton = page.locator('[data-testid="toolbar-add-row"]');
  await expect(addRowButton).toBeDisabled();
  await assertTooltipShows(page, addRowButton, 'Connection is read-only');

  // --- scenario 4: pointer-events: none (D4) + accessibility (D7) --------------------------
  const projectPanel = page.locator('[data-testid="project-panel"]');
  const wasVisible = (await projectPanel.count()) > 0;
  const toggleButton = page.locator('[data-testid="toggle-project-panel"]');
  await assertTooltipShows(page, toggleButton, 'Connections');
  await expect(toggleButton).toHaveAttribute('aria-describedby', 'app-tooltip');
  await expect(toggleButton).toHaveAttribute('aria-label', 'Connections');

  // The tooltip sits at a higher z-index than everything else in the app, directly over the
  // button it describes — if it intercepted pointer events, this click would hit the tooltip
  // instead and the panel would never toggle.
  await toggleButton.click();
  await expect(projectPanel).toHaveCount(wasVisible ? 0 : 1);
  await toggleButton.click(); // restore, so the tree is still usable if anything runs after this
  await expect(projectPanel).toHaveCount(wasVisible ? 1 : 0);

  // --- scenario 5: a structured tooltip (P42 D19/D20) — the grid header's own name/type/
  // description renders as three separate elements, while data-kira-tip stays the exact same
  // newline-joined plain text every existing assertion (and the a11y mirror) already reads. -----
  const tenantIdHeader = page.locator('[data-testid="grid-header-cell"][data-column="tenant_id"]');
  await tenantIdHeader.hover();
  await expect(tooltip(page)).toBeVisible({ timeout: 1_000 });
  await expect(tooltip(page).locator('.tip-title')).toHaveText('tenant_id');
  await expect(tooltip(page).locator('.tip-meta')).not.toBeEmpty();
  await expect(tooltip(page).locator('.tip-body')).not.toBeEmpty();
  const meta = (await tooltip(page).locator('.tip-meta').innerText()).trim();
  const body = (await tooltip(page).locator('.tip-body').innerText()).trim();
  await expect(tenantIdHeader).toHaveAttribute(
    'data-kira-tip',
    ['tenant_id', meta, body].join('\n'),
  );
  await expect(tenantIdHeader).toHaveAttribute('aria-label', ['tenant_id', meta, body].join('\n'));

  // A plain-string tooltip elsewhere is unaffected — still one text node, no parts.
  await page.mouse.move(4, 4);
  await page.waitForTimeout(350);
  await assertTooltipShows(page, refreshButton, 'Refresh');
  await expect(tooltip(page).locator('.tip-title')).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
});
