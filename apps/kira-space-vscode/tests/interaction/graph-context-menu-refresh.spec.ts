import { expect, type Page, test } from '@playwright/test';
import { buildFakeGraphHostInitScript, FAKE_REPO_ID } from './support/fakeGraphHost.ts';
import { type InteractionServer, startInteractionServer } from './support/server.ts';

/**
 * P108 F2 regression: `App.vue`'s commit-row context menu used to store only `{row, x, y}` and
 * re-resolve the commit (`graphView.store.commitAt(state.row)`) at *select* time, not open time.
 * An auto-refresh (`graph.status`/`refsChanged`) restarts the store at row 0 and re-streams —
 * `graphView.generation` bumps — while the menu can still be open; the row index then names
 * whatever commit now happens to sit there, and a destructive action (reset, revert) would run
 * against it instead of what the user actually right-clicked.
 *
 * Fixed by capturing the `CommitRecord` itself at open time and closing the menu outright on any
 * `graphView.generation` change (`App.vue`'s own `watch(graphView.generation, ...)`), so a refresh
 * mid-menu can never silently retarget a pending action — the user re-opens the menu against
 * whatever is really there now instead.
 */
test.describe('commit context menu vs. auto-refresh (P108 F2)', () => {
  let server: InteractionServer;

  test.beforeAll(async () => {
    server = await startInteractionServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  async function emitRepoChanged(page: Page, kind: string, repoId?: string): Promise<void> {
    await page.evaluate(
      ([k, id]) =>
        (
          window as unknown as {
            __emitRepoChanged?: (kind: string, repoId?: string) => void;
          }
        ).__emitRepoChanged?.(k, id),
      [kind, repoId] as const,
    );
  }

  test('a refresh mid-menu closes the context menu instead of leaving it targeting a stale row', async ({
    page,
  }) => {
    await page.addInitScript(buildFakeGraphHostInitScript());
    await page.goto(`${server.url}/graph`);

    const row = page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"]');
    await expect(row).toBeVisible();

    await row.click({ button: 'right' });
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    // Same auto-refresh trigger `graph-columns.spec.ts` already drives end to end — a real
    // `repo.changed` frame, not a synthetic generation bump.
    await emitRepoChanged(page, 'refsChanged', FAKE_REPO_ID);

    await expect(menu).toBeHidden();
  });
});
