import { expect, test } from './fixtures';

// Writes to settings/layout go through async IPC (layout is additionally debounced by
// state/layout.ts). Give them time to land before closing the app and relaunching.
const PERSIST_SETTLE_MS = 300;

test('panel visibility toggles persist across relaunch', async ({ relaunch }) => {
  let { window } = await relaunch();

  await expect(window.locator('[data-testid="project-panel"]')).toBeVisible();
  await window.click('[data-testid="toggle-project-panel"]');
  await expect(window.locator('[data-testid="project-panel"]')).toHaveCount(0);

  await expect(window.locator('[data-testid="operations-panel"]')).toHaveCount(0);
  await window.click('[data-testid="toggle-operations-panel"]');
  await expect(window.locator('[data-testid="operations-panel"]')).toBeVisible();

  await window.waitForTimeout(PERSIST_SETTLE_MS);
  ({ window } = await relaunch());

  await expect(window.locator('[data-testid="project-panel"]')).toHaveCount(0);
  await expect(window.locator('[data-testid="operations-panel"]')).toBeVisible();
});

// P31 item 4/D8: 6px top/right/left inset from the window edge, 2px (--kira-gap, unchanged)
// on the bottom so the status bar still reads as seated on the window edge.
test('the workbench is inset from the window edge on three sides (P31 D8)', async ({
  relaunch,
}) => {
  const { window } = await relaunch();
  const shell = window.locator('.workbench-shell');
  const padding = await shell.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      top: style.paddingTop,
      right: style.paddingRight,
      bottom: style.paddingBottom,
      left: style.paddingLeft,
    };
  });
  expect(padding.top).toBe('6px');
  expect(padding.right).toBe('6px');
  expect(padding.left).toBe('6px');
  expect(padding.bottom).toBe('2px');

  const [shellBox, projectBox] = await Promise.all([
    shell.boundingBox(),
    window.locator('[data-testid="project-panel"]').boundingBox(),
  ]);
  if (!shellBox || !projectBox) throw new Error('bounding boxes not found');
  expect(projectBox.x - shellBox.x).toBeGreaterThanOrEqual(6);
});

test('settings dialog appearance font size persists across relaunch', async ({ relaunch }) => {
  let { window } = await relaunch();

  await window.click('[data-testid="open-settings"]');
  await expect(window.locator('[data-testid="settings-dialog"]')).toBeVisible();

  for (const section of ['Appearance', 'Data', 'Cache', 'Advanced']) {
    await expect(window.locator(`[data-testid="settings-section-${section}"]`)).toBeVisible();
  }

  await window.click('[data-testid="settings-section-Appearance"]');
  await window.locator('.section-pane input[type="number"]').fill('16');
  await window.locator('.section-pane input[type="number"]').dispatchEvent('change');

  await expect
    .poll(() =>
      window.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--kira-font-size'),
      ),
    )
    .toBe('16px');

  await window.screenshot({ path: 'test-results/screenshots/settings.png' });
  await window.click('[data-testid="settings-close"]');

  await window.waitForTimeout(PERSIST_SETTLE_MS);
  ({ window } = await relaunch());

  await expect
    .poll(() =>
      window.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--kira-font-size'),
      ),
    )
    .toBe('16px');
});

test('settings dialog Advanced section persists across relaunch', async ({ relaunch }) => {
  let { window } = await relaunch();

  await window.click('[data-testid="open-settings"]');
  await expect(window.locator('[data-testid="settings-dialog"]')).toBeVisible();
  await window.click('[data-testid="settings-section-Advanced"]');

  await window.fill('[data-testid="settings-engine-memory-cap"]', '768');
  await window.locator('[data-testid="settings-engine-memory-cap"]').dispatchEvent('change');
  await window.fill('[data-testid="settings-oplog-retention"]', '45');
  await window.locator('[data-testid="settings-oplog-retention"]').dispatchEvent('change');

  await window.click('[data-testid="settings-close"]');
  await window.waitForTimeout(PERSIST_SETTLE_MS);
  ({ window } = await relaunch());

  await window.click('[data-testid="open-settings"]');
  await window.click('[data-testid="settings-section-Advanced"]');
  await expect(window.locator('[data-testid="settings-engine-memory-cap"]')).toHaveValue('768');
  await expect(window.locator('[data-testid="settings-oplog-retention"]')).toHaveValue('45');
});

test('a settings patch to one section leaves the other sections untouched (F15, D15)', async ({
  relaunch,
}) => {
  let { window } = await relaunch();

  // --- first session: patch Appearance only -------------------------------------------------
  await window.click('[data-testid="open-settings"]');
  await window.click('[data-testid="settings-section-Appearance"]');
  await window.locator('.section-pane input[type="number"]').fill('18');
  await window.locator('.section-pane input[type="number"]').dispatchEvent('change');
  await expect
    .poll(() =>
      window.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--kira-font-size'),
      ),
    )
    .toBe('18px');
  await window.click('[data-testid="settings-close"]');
  await window.waitForTimeout(PERSIST_SETTLE_MS);

  // --- second session: patch Advanced only — a write-narrowed setSettings() must not touch
  // Appearance's already-stored row while doing this. -----------------------------------------
  ({ window } = await relaunch());
  await window.click('[data-testid="open-settings"]');
  await window.click('[data-testid="settings-section-Advanced"]');
  await window.fill('[data-testid="settings-engine-memory-cap"]', '640');
  await window.locator('[data-testid="settings-engine-memory-cap"]').dispatchEvent('change');
  await window.click('[data-testid="settings-close"]');
  await window.waitForTimeout(PERSIST_SETTLE_MS);

  // --- a third, fresh session must show both writes intact ----------------------------------
  ({ window } = await relaunch());
  await expect
    .poll(() =>
      window.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--kira-font-size'),
      ),
    )
    .toBe('18px');

  await window.click('[data-testid="open-settings"]');
  await window.click('[data-testid="settings-section-Advanced"]');
  await expect(window.locator('[data-testid="settings-engine-memory-cap"]')).toHaveValue('640');
});
