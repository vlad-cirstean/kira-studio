import { expect, test } from '@playwright/test';
import {
  buildManyCommitsInitScript,
  MANY_BRANCH,
  MANY_REPO_ID,
} from './support/fakeReviewHostManyCommits.ts';
import { type InteractionServer, startInteractionServer } from './support/server.ts';

/**
 * G32 round-3 performance review, finding #2: the review commit list used to mount one
 * `ReviewCommitRow` per LOADED row with no cap — a single "Load more" page (up to 5,000 rows,
 * `logsession.DefaultPageSize`) mounted 5,000 components synchronously. Verifies the fix
 * (`ReviewView.vue`'s own `renderCap`) against the real built webview: with 600 rows delivered in
 * one stream chunk, only `REVIEW_ROW_RENDER_CAP` (500) are ever mounted at once, and the
 * client-side "Show more" button (no network — see the fixture's own doc comment) reveals the
 * rest without a page reload.
 */
test.describe('review commit list render cap', () => {
  let server: InteractionServer;
  const COMMIT_COUNT = 600;

  test.beforeAll(async () => {
    server = await startInteractionServer({
      reviewTarget: { repoId: MANY_REPO_ID, branch: MANY_BRANCH },
    });
  });

  test.afterAll(async () => {
    await server.close();
  });

  test('mounts at most the render cap, and "Show more" reveals the rest', async ({ page }) => {
    await page.addInitScript(buildManyCommitsInitScript(COMMIT_COUNT));
    await page.goto(`${server.url}/review`);

    const rows = page.locator('[data-testid^="review-row-"]');
    await expect(rows.first()).toBeVisible();

    const initialCount = await rows.count();
    expect(initialCount).toBeLessThan(COMMIT_COUNT);
    expect(initialCount).toBe(500);

    const showMore = page.locator('.kv-review-load-more-button');
    await expect(showMore).toBeVisible();
    await expect(showMore).toHaveText(/Show 100 more/);
    await showMore.click();

    await expect(rows).toHaveCount(COMMIT_COUNT);
    await expect(showMore).toBeHidden();
  });
});
