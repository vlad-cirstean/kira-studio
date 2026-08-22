import { expect, test } from './fixtures';

// Writes to settings/layout go through async IPC (layout is additionally debounced by
// state/layout.ts). Give them time to land before closing the app and relaunching.
const PERSIST_SETTLE_MS = 300;

test('connect ops carry a null tabId (no tab exists yet)', async ({ kira, relaunch }) => {
  const { window } = kira;
  const created = await window.evaluate(
    () =>
      (window as unknown as { kira: { connectionsCreate: (i: unknown) => Promise<unknown> } }).kira
        .connectionsCreate({
          name: 'pg',
          kind: 'postgres',
          color: 'blue',
          mode: 'fields',
          readOnly: false,
          host: 'localhost',
          port: 5432,
          database: 'postgres',
          username: 'postgres',
          password: 'wrong',
          uri: null,
          options: {},
        }),
  );
  const id = (created as { id: string }).id;
  await window.evaluate(
    (x) =>
      (window as unknown as { kira: { connectionsConnect: (i: unknown) => Promise<unknown> } }).kira
        .connectionsConnect({ id: x }),
    id,
  ).catch(() => {});

  // The connect op lands in op_log with tabId null (D9); assert end-to-end it is null, not ''.
  await expect
    .poll(async () => {
      const ops = await window.evaluate(
        () => (window as unknown as { kira: { opsRecent: (i: unknown) => Promise<unknown> } }).kira.opsRecent({ limit: 20 }),
      );
      return (ops as Array<{ kind: string; tabId: string | null }>).find((o) => o.kind === 'connect') ?? null;
    })
    .toBeTruthy();
  const connectOp = await window.evaluate(
    () => (window as unknown as { kira: { opsRecent: (i: unknown) => Promise<unknown> } }).kira.opsRecent({ limit: 20 }),
  ).then((ops) => (ops as Array<{ kind: string; tabId: string | null }>).find((o) => o.kind === 'connect'));
  expect(connectOp?.tabId).toBeNull();
  await relaunch();
});

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
  await window.click('[data-testid="settings-save"]');

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
