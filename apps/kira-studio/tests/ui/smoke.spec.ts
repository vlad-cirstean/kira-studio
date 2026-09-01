import { expect, test } from './fixtures';

// Ported from tests/e2e/smoke.spec.ts (P57 D16). The app-name assertion (`app.evaluate(({app}) =>
// app.getName())`) has no analogue here — there is no Electron `app` object, and the bundle's
// display name (P57 D11) is a packaged-build property this tier's static server never sets up;
// it stays a manual macOS check (§6).
test('workbench launches with all chrome regions and a healthy engine', async ({
  kira,
  consoleErrors,
}) => {
  // Toggling the operations panel below debounce-persists the new layout (state/layout.ts) — one
  // `layoutSet` call this test doesn't assert on, answered by mockRuntime.ts's own
  // `WILDCARD_DEFAULTS` (no fixture needs to spell it out).
  const { window } = kira;

  // 'toolbar' is intentionally not a fixed shell region any more (P16 design system LAW 09):
  // each view now renders its own toolbar, so with no connections/tabs (this fixture's empty
  // boot) there is none — the tab strip stays mounted but empty, and MainView's own FirstRun
  // screen is what actually carries the "what do I do now" messaging.
  const alwaysPresent = ['project-panel', 'tab-strip', 'main-view', 'status-bar'];
  for (const testid of alwaysPresent) {
    await expect(window.locator(`[data-testid="${testid}"]`)).toBeVisible();
  }

  // The cell editor panel is driven by cell selection, not a fixed shell region — with no
  // connections/tabs open yet, nothing is selected, so it starts hidden.
  await expect(window.locator('[data-testid="cell-editor"]')).toHaveCount(0);

  // Operations panel starts hidden (defaultLayout.panel.operations.visible === false).
  await expect(window.locator('[data-testid="operations-panel"]')).toHaveCount(0);
  await window.click('[data-testid="toggle-operations-panel"]');
  await expect(window.locator('[data-testid="operations-panel"]')).toBeVisible();

  await expect(window.locator('[data-testid="engine-status"]')).toHaveAttribute(
    'data-status',
    'ok',
  );

  await window.screenshot({ path: 'test-results/screenshots/workbench.png' });

  expect(consoleErrors).toEqual([]);
});
