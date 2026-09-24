import { expect, test } from '@playwright/test';
import { buildFakeGraphHostInitScript } from './support/fakeGraphHost.ts';
import { type InteractionServer, startInteractionServer } from './support/server.ts';

/**
 * P108 F3 regression: `App.vue`'s dialog/menu refs (`repoSettingsDialogOpen` among them) used to
 * survive a repo switch or a reconnect untouched — a dialog left open across either kept acting on
 * (or simply displaying stale data for) the *old* repo.
 *
 * `BridgeClient.onReconnect`'s own doc comment: a non-`'connected'` -> `'connected'`
 * `connection.changed` transition is a genuine reconnect (the host's new `Conn` holds no repo) —
 * `App.vue`'s `handleReconnect` re-opens the active repo and calls `applyRepoIdToStates` directly,
 * the same lifecycle point a real repo switch runs through. Fixed by clearing every dialog/menu
 * ref there (this file's own P108 F2 fix already covers the two context menus the same way).
 *
 * The server seeds a `connecting` boot state (`startInteractionServer`'s own default is already
 * `connected`, which a same-kind re-push is specifically a no-op for) so the later `'connected'`
 * push is a real transition, not a repeat.
 */
test.describe('repo-settings dialog vs. reconnect (P108 F3)', () => {
  let server: InteractionServer;

  test.beforeAll(async () => {
    server = await startInteractionServer({ connectionState: { kind: 'connecting' } });
  });

  test.afterAll(async () => {
    await server.close();
  });

  test('a reconnect while the repo-settings dialog is open closes it', async ({ page }) => {
    await page.addInitScript(buildFakeGraphHostInitScript());
    await page.goto(`${server.url}/graph`);

    await page.locator('[data-testid="repo-settings-button"]').click();
    const dialog = page.getByRole('dialog', { name: 'Repository settings' });
    await expect(dialog).toBeVisible();

    await page.evaluate(() => {
      (
        window as unknown as { __emitConnectionChanged?: (kind: string) => void }
      ).__emitConnectionChanged?.('connected');
    });

    await expect(dialog).toBeHidden();
  });
});
