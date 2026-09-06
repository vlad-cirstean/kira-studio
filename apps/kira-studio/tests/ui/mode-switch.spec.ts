import type { Locator, Page } from '@playwright/test';
import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import {
  ORDER_ITEMS_PATH,
  orderItemsFixture,
  postgresConnectionSummary,
} from './support/postgresFixture';
import { connectionRow, expandRow, findRow, openRowMenu } from './support/tree';

// P1 C9/§6.2: the mode seam, observed from outside. Studio's own connect/expand/open flow is
// ported straight from tabs.spec.ts's own createAndConnect (C1-C8 promise Studio's rendered
// output doesn't change) — what's new here is Http mode existing at all, and the five properties
// §6.2 names: two mode tabs; Http is genuinely empty with its own left-panel title; switching back
// restores Studio's tab untouched; switching mode writes nothing; the left panel's width survives;
// ⌘B still works in either mode.

const CONNECTION_ID = 'conn-mode-switch';
const FIXTURE = orderItemsFixture(CONNECTION_ID);
const CONNECTION_SUMMARY = postgresConnectionSummary(CONNECTION_ID, 'Mode DB', 'blue');

const CONTROL: ControlSnapshot[] = [
  { channel: IPC.connectionsList, response: [] },
  {
    channel: IPC.connectionsCreate,
    args: {
      name: 'Mode DB',
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

async function createAndConnect(page: import('@playwright/test').Page): Promise<void> {
  await page.click('[data-testid="add-connection"]');
  await page.click('[data-testid="connection-kind-postgres"]');
  await page.fill('[data-testid="connection-name"]', 'Mode DB');
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
}

function modeTab(page: import('@playwright/test').Page, mode: 'studio' | 'api') {
  return page.locator(`[data-testid="mode-tab"][data-mode="${mode}"]`);
}

test('mode switch — two mode tabs, an empty Http mode, and Studio state that survives the round trip', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({ control: CONTROL });

  // 1. two mode tabs, Studio active by default.
  await expect(page.locator('[data-testid="mode-tab"]')).toHaveCount(2);
  await expect(modeTab(page, 'studio')).toHaveClass(/is-active/);
  await expect(modeTab(page, 'api')).not.toHaveClass(/is-active/);
  await expect(page.locator('[data-testid="project-panel"]')).toContainText('Connections');

  // Build a real Studio tab with non-default state (page size 1000) to prove it survives.
  await createAndConnect(page);
  const orderItemsRow = await findRow(page, ORDER_ITEMS_PATH);
  await orderItemsRow.dblclick();
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  await page.click('[data-testid="page-size-1000"]');
  await expect(page.locator('[data-testid="page-size-1000"]')).toHaveClass(/on/);

  const studioTab = page.locator('[data-testid="tab"]');
  await expect(studioTab).toHaveCount(1);
  const studioTabId = await studioTab.getAttribute('data-tab-id');

  const panelWidthBefore = (await page.locator('[data-testid="project-panel"]').boundingBox())
    ?.width;
  const tabsSaveCallsBeforeSwitch = control
    .log()
    .filter((entry) => entry.channel === IPC.tabsSave).length;

  // 2. clicking Http shows the empty tab-strip state and Http's own empty content, with the left
  //    panel no longer titled "Connections".
  await modeTab(page, 'api').click();
  await expect(modeTab(page, 'api')).toHaveClass(/is-active/);
  await expect(modeTab(page, 'studio')).not.toHaveClass(/is-active/);
  await expect(page.locator('[data-testid="tab-strip-empty"]')).toBeVisible();
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="api-start"]')).toBeVisible();
  await expect(page.locator('[data-testid="project-panel"]')).not.toContainText('Connections');
  await expect(page.locator('[data-testid="project-panel"]')).toContainText('Collections');

  // "mode switching writes nothing" (D5), observed: no tabsSave call happened just from the two
  // clicks above — clicking a mode tab is a plain selection, not a mutation.
  const tabsSaveCallsAfterSwitch = control
    .log()
    .filter((entry) => entry.channel === IPC.tabsSave).length;
  expect(tabsSaveCallsAfterSwitch).toBe(tabsSaveCallsBeforeSwitch);

  // 3. clicking Studio restores the same tab, still active, with its state intact.
  await modeTab(page, 'studio').click();
  await expect(modeTab(page, 'studio')).toHaveClass(/is-active/);
  const restoredTab = page.locator('[data-testid="tab"]');
  await expect(restoredTab).toHaveCount(1);
  await expect(restoredTab).toHaveAttribute('data-tab-id', studioTabId ?? '');
  await expect(restoredTab).toHaveClass(/is-active/);
  await expect(page.locator('[data-testid="data-grid"]')).toBeVisible();
  await expect(page.locator('[data-testid="page-size-1000"]')).toHaveClass(/on/);

  // 4. the left panel's width is preserved across the switch (D8: both modes share one width).
  const panelWidthAfter = (await page.locator('[data-testid="project-panel"]').boundingBox())
    ?.width;
  expect(panelWidthAfter).toBe(panelWidthBefore);

  // 5. ⌘B still collapses/expands the panel in either mode. There is no real Wails window in
  //    tests/ui to dispatch the native ⌘B menu accelerator through, so this drives the status
  //    bar's own toggle button — the exact same toggleProjectPanel() the accelerator itself
  //    invokes (App.vue's control.onToggleProjectPanel(toggleProjectPanel)).
  await page.click('[data-testid="toggle-project-panel"]');
  await expect(page.locator('[data-testid="project-panel"]')).toHaveCount(0);
  await page.click('[data-testid="toggle-project-panel"]');
  await expect(page.locator('[data-testid="project-panel"]')).toBeVisible();

  await modeTab(page, 'api').click();
  await page.click('[data-testid="toggle-project-panel"]');
  await expect(page.locator('[data-testid="project-panel"]')).toHaveCount(0);
  await page.click('[data-testid="toggle-project-panel"]');
  await expect(page.locator('[data-testid="project-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="project-panel"]')).toContainText('Collections');
});

// P18 D15/F18 built the box-level fix (a real .icon-box and a real <span> label, both real flex
// items with a measurable rect) and a guard that held *by construction*: a fixed-size .icon-box
// centres each glyph's own advance, not its ink, so the guard could never see the two things a
// user actually reads — F8/F9 name this as the reason the same complaint came back a third time.
// P22 D5 replaces both of that guard's assertions with an ink measurement: screenshot the icon
// and the label, find each one's own painted pixels (differing from its own sampled background)
// rather than trust the fixed box each sits in, and compare the ink itself.
async function inkBounds(
  locator: Locator,
): Promise<{ top: number; bottom: number; left: number; right: number } | null> {
  const box = await locator.boundingBox();
  if (!box) return null;
  const base64 = (await locator.screenshot()).toString('base64');
  const rel = await locator.page().evaluate(async (b64) => {
    const img = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('mode-tab ink screenshot failed to decode'));
    });
    img.src = `data:image/png;base64,${b64}`;
    await loaded;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('mode-tab ink measurement: no 2d context');
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // The crop's own corner pixel is its background — .icon-box and .mode-label paint no fill of
    // their own, so this is whatever sits behind them (the tab's own ground either way).
    const bg = [data[0], data[1], data[2]];
    const THRESHOLD = 24; // per-channel delta that counts as "ink", tolerant of anti-aliasing
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const dr = Math.abs(data[i] - bg[0]);
        const dg = Math.abs(data[i + 1] - bg[1]);
        const db = Math.abs(data[i + 2] - bg[2]);
        if (dr > THRESHOLD || dg > THRESHOLD || db > THRESHOLD) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (minX === Number.POSITIVE_INFINITY) return null;
    return { minX, maxX, minY, maxY, width, height };
  }, base64);
  if (!rel) return null;
  const scaleX = box.width / rel.width;
  const scaleY = box.height / rel.height;
  return {
    left: box.x + rel.minX * scaleX,
    right: box.x + (rel.maxX + 1) * scaleX,
    top: box.y + rel.minY * scaleY,
    bottom: box.y + (rel.maxY + 1) * scaleY,
  };
}

async function modeTabInk(
  page: Page,
  mode: 'studio' | 'api',
): Promise<{ iconCentreY: number; labelCentreY: number; iconRightInset: number }> {
  const tab = modeTab(page, mode);
  const iconBoxLocator = tab.locator('.icon-box');
  const iconBox = await iconBoxLocator.boundingBox();
  const iconInk = await inkBounds(iconBoxLocator);
  const labelInk = await inkBounds(tab.locator('.mode-label'));
  if (!iconBox || !iconInk || !labelInk) {
    throw new Error(`mode tab "${mode}" has no measurable icon/label ink`);
  }
  return {
    iconCentreY: (iconInk.top + iconInk.bottom) / 2,
    labelCentreY: (labelInk.top + labelInk.bottom) / 2,
    // The .icon-box's own trailing edge to the glyph's own rightmost ink — how much of the box a
    // rendered-at-native-size glyph actually fills, the direct, verifiable claim D6(a) makes
    // ("the codicon's own 16-unit design grid and its 16px slot coincide"). At 13px-in-16px this
    // always carried (16-13)/2 = 1.5px of pure box slack *in addition to* the glyph's own side
    // bearing; at 16px only the glyph's own bearing remains.
    iconRightInset: iconBox.x + iconBox.width - iconInk.right,
  };
}

test('a mode tab’s icon renders at its own design size, with its ink lined up against the label (P22 D5/D6)', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: [] });

  const studio = await modeTabInk(page, 'studio');
  const api = await modeTabInk(page, 'api');

  // (a) F9(a)/D6(a): both icons render close to filling their own 16px box — measured, not
  // merely inferred from the font's stated design grid. Before D6 (a 13px glyph in a 16px box)
  // this sandbox's own headless-Chromium render measures a 4px inset on "database" alone, purely
  // from the box/glyph size mismatch, on top of whatever the glyph's own side bearing adds; at
  // native size that mismatch is gone and only the glyph's own (smaller) bearing remains.
  for (const { iconRightInset } of [studio, api]) {
    expect(iconRightInset).toBeLessThanOrEqual(3.5);
  }

  // (b) the icon's ink and the label's ink are vertically centred on the same line, on both tabs
  // — not merely the fixed boxes they sit in (F8's own point: a box-level guard can't see this).
  // A generous tolerance: F9(b)'s own residual is sub-pixel on the two words this app actually
  // renders ("Studio" has no descender, "Api" does — a real, permanent, per-word difference in
  // ink extent that a shared line-height can't and shouldn't erase).
  for (const { iconCentreY, labelCentreY } of [studio, api]) {
    expect(Math.abs(iconCentreY - labelCentreY)).toBeLessThanOrEqual(1.5);
  }

  // F9(a)'s own point stands even after (a): "database" and "globe" are drawn with genuinely
  // different side bearings at any shared box size, so their icon-to-label gaps are not expected
  // to match pixel-for-pixel without normalizing the icon vocabulary itself (OQ-3, inline SVG) —
  // that residual is deliberately not asserted here as a "must match" quantity.
});
