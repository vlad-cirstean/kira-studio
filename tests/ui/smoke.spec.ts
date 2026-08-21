import { expect, test } from './fixtures';

test('workbench launches with all chrome regions and a healthy engine', async ({
  kira,
  consoleErrors,
}) => {
  const { app, window } = kira;

  expect(app.windows().length).toBe(1);
  expect(await app.evaluate(({ app: electronApp }) => electronApp.getName())).toBe('Kira Studio');

  const alwaysPresent = [
    'project-panel',
    'tab-strip',
    'toolbar',
    'main-view',
    'cell-editor',
    'status-bar',
  ];
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
