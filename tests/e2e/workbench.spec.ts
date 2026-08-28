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

// P42 F17: Chromium's own unstyled default for this pseudo-element is opaque white, which
// survives every theme (it uses none of this app's own tokens) until base.css overrides it.
test("the scrollbar corner is not left at Chromium's opaque-white default (P42 F17)", async ({
  relaunch,
}) => {
  const { window } = await relaunch();
  const corner = await window.evaluate(
    () => getComputedStyle(document.documentElement, '::-webkit-scrollbar-corner').backgroundColor,
  );
  expect(corner).not.toBe('rgb(255, 255, 255)');
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

  // --- P31 item 3/D9/D10: an installed family applies and survives; an unavailable one is
  // marked invalid, names the fallback, but is still saved (F10/F11). "Liberation Sans" is a
  // real installed face in this Linux sandbox (fc-list) — "Georgia" is not, so it is not a valid
  // stand-in for "an installed family" here the way it would be on macOS.
  //
  // Locator.fill()/keyboard typing on this field is unreliable in this Electron/Chromium build
  // (list-attribute combobox role — fill() leaves the value untouched, and Ctrl+A/Backspace does
  // not clear it either), so the value is written via the native property setter directly and
  // the relevant DOM event is dispatched by hand instead. -------------------------------------
  const familyInput = window.locator('input[list="kira-font-families"]');
  async function typeFontFamily(
    value: string,
    ...events: Array<'input' | 'change'>
  ): Promise<void> {
    await familyInput.evaluate(
      (el: HTMLInputElement, [v, evts]: [string, string[]]) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(el, v);
        for (const type of evts) el.dispatchEvent(new Event(type, { bubbles: true }));
      },
      [value, events] as [string, string[]],
    );
  }

  await typeFontFamily('"Liberation Sans", sans-serif', 'input', 'change');
  await expect
    .poll(() =>
      window.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--kira-font-family'),
      ),
    )
    .toBe('"Liberation Sans", sans-serif');
  await expect(window.locator('[data-testid="font-unavailable"]')).toHaveCount(0);
  await expect(
    window.evaluate(() => getComputedStyle(document.body).fontFamily),
  ).resolves.toContain('Liberation Sans');

  await typeFontFamily('KiraNoSuchFontXyz', 'input');
  await expect(window.locator('[data-testid="font-unavailable"]')).toBeVisible();
  await expect(window.locator('.p-input.is-invalid')).toBeVisible();
  await typeFontFamily('KiraNoSuchFontXyz', 'change');
  await expect
    .poll(() =>
      window.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--kira-font-family'),
      ),
    )
    .toBe('KiraNoSuchFontXyz');

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
  await expect
    .poll(() =>
      window.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--kira-font-family'),
      ),
    )
    .toBe('KiraNoSuchFontXyz');
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

// P42 D14: on by default (a settings row saved before this field existed has no key at all, so
// `.default(true)` fires and it restores on — the same claim startup.spec.ts's restored-session
// scenario guards for the whole Settings row).
test('word wrap setting persists across relaunch', async ({ relaunch }) => {
  let { window } = await relaunch();

  await window.click('[data-testid="open-settings"]');
  await window.click('[data-testid="settings-section-Appearance"]');
  const wordWrapToggle = window.locator('[data-testid="settings-word-wrap"]');
  await expect(wordWrapToggle).toBeChecked();

  await wordWrapToggle.uncheck();
  await window.click('[data-testid="settings-close"]');
  await window.waitForTimeout(PERSIST_SETTLE_MS);
  ({ window } = await relaunch());

  await window.click('[data-testid="open-settings"]');
  await window.click('[data-testid="settings-section-Appearance"]');
  await expect(window.locator('[data-testid="settings-word-wrap"]')).not.toBeChecked();
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
