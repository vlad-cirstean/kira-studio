import { expect, test } from './fixtures';

test('workbench launches with all chrome regions and a healthy engine', async ({
  kira,
  consoleErrors,
}) => {
  const { app, window } = kira;

  expect(app.windows().length).toBe(1);
  expect(await app.evaluate(({ app: electronApp }) => electronApp.getName())).toBe('Kira Studio');

  // 'toolbar' is intentionally not a fixed shell region any more (P16 design system LAW 09):
  // each view now renders its own toolbar, so with no connections/tabs (this fixture's fresh
  // KIRA_HOME) there is none — only the tab strip and its own "no tabs" affordance remain.
  const alwaysPresent = ['project-panel', 'tab-strip', 'main-view', 'cell-editor', 'status-bar'];
  for (const testid of alwaysPresent) {
    await expect(window.locator(`[data-testid="${testid}"]`)).toBeVisible();
  }

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
