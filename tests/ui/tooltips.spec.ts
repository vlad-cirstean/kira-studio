import type { Locator, Page } from '@playwright/test';
import type { ConnectionColor } from '@shared/domain/connection';
import { expect, test } from './fixtures';
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  isDockerAvailable,
  type PgFixture,
  startPostgres,
} from './support/pg';

// P22: the app-owned tooltip mechanism (workbench/state/tooltip.ts + AppTooltip.vue), replacing
// the native `title` attribute everywhere in src/renderer. The two scenarios below that matter
// most are the ones a naive `mouseenter`-based implementation would fail: a *disabled* control
// (F5 — Blink dispatches no pointer events on one, which is exactly why D3 hit-tests via
// `elementFromPoint` on a document-level `pointermove` instead) and a control living *inside an
// already-open popover* (F3(a) — the popover's own backdrop must not swallow the hit test).
test.describe.configure({ timeout: 300_000 });

let pg: PgFixture | null = null;

test.beforeAll(async () => {
  test.setTimeout(300_000);
  if (!(await isDockerAvailable())) {
    test.skip(true, DOCKER_UNAVAILABLE_MESSAGE);
    return;
  }
  pg = await startPostgres();
});

test.afterAll(async () => {
  await pg?.stop();
});

const DB_PATH = 'database:kira_test';
const APP_PATH = `${DB_PATH}/schema:app`;
// Same fixture table mutations.spec.ts uses for edit/insert scenarios: a genuine primary key,
// no inbound foreign key — here it's the PK checkbox in ColumnsMenu that scenario 3 needs.
const COMPOSITE_PATH = `${APP_PATH}/table:composite_pk`;

function treeContainer(page: Page): Locator {
  return page.locator('[data-testid="tree-background"] .virtual-list');
}

async function findRow(page: Page, path: string): Promise<Locator> {
  const container = treeContainer(page);
  const target = page.locator(`[data-testid="tree-row"][data-path="${path}"]`);
  await container.evaluate((el) => {
    el.scrollTop = 0;
  });
  for (let i = 0; i < 80; i++) {
    if ((await target.count()) > 0) return target;
    const atBottom = await container.evaluate(
      (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1,
    );
    if (atBottom) break;
    await container.evaluate((el) => {
      el.scrollTop += Math.max(200, el.clientHeight);
    });
    await page.waitForTimeout(30);
  }
  return target;
}

async function expandRow(page: Page, path: string): Promise<Locator> {
  const row = await findRow(page, path);
  await expect(row).toBeVisible();
  await row.locator('.twisty').click();
  await expect(row.locator('.twisty .spin')).toHaveCount(0, { timeout: 15_000 });
  return row;
}

async function createConnection(
  page: Page,
  cfg: {
    host: string | null;
    port: number | null;
    database: string | null;
    username: string | null;
    password: string | null;
  },
  opts: { name: string; color: ConnectionColor; readOnly: boolean },
): Promise<string> {
  return page.evaluate(
    ({ cfg, opts }) =>
      window.kira
        .connectionsCreate({
          name: opts.name,
          kind: 'postgres',
          color: opts.color,
          mode: 'fields',
          readOnly: opts.readOnly,
          host: cfg.host,
          port: cfg.port,
          database: cfg.database,
          username: cfg.username,
          password: cfg.password,
          uri: null,
          options: {},
          preconnect: null,
          preconnectSidecar: false,
        })
        .then((c) => c.id),
    { cfg, opts },
  );
}

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
  kira,
  consoleErrors,
}) => {
  test.setTimeout(300_000);
  if (!pg) throw new Error('postgres fixture did not start');
  const { window: page } = kira;

  const cfg = {
    host: pg.config.host,
    port: pg.config.port,
    database: pg.config.database,
    username: pg.config.username,
    password: pg.config.password,
  };
  await createConnection(page, cfg, { name: 'Tooltips DB', color: 'blue', readOnly: false });

  const connRow = page.locator('[data-testid="tree-row"][data-kind="connection"]');
  await expect(connRow).toBeVisible();
  await connRow.click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await page.click('[data-testid="menu-item-connect"]');
  await expect(connRow.locator('.status-dot')).toHaveAttribute('data-status', 'connected', {
    timeout: 10_000,
  });
  await expandRow(page, '');
  await expandRow(page, DB_PATH);
  await expandRow(page, APP_PATH);
  await (await findRow(page, COMPOSITE_PATH)).dblclick();
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();

  // --- scenario 1: an enabled control — hidden before the delay, shown after, hides on leave ---
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
  await createConnection(page, cfg, { name: 'Tooltips DB (RO)', color: 'red', readOnly: true });
  const roConnRow = page
    .locator('[data-testid="tree-row"][data-kind="connection"]')
    .filter({ hasText: 'Tooltips DB (RO)' });
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
  await (await findRow(page, COMPOSITE_PATH)).dblclick();
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

  expect(consoleErrors).toEqual([]);
});
