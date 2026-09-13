import { expect, test } from '@playwright/test';
import {
  buildFakeHostInitScript,
  FAKE_BRANCH,
  FAKE_FILE_PATH,
  FAKE_REPO_ID,
  FAKE_SHA,
} from './support/fakeReviewHost.ts';
import { type InteractionServer, startInteractionServer } from './support/server.ts';

/**
 * G19 §4.2/§8.4: the review sidebar's interaction tier, over the narrowly-scoped fake-transport
 * fixture (`fakeReviewHost.ts` — four hand-written responses, not a general mock RPC layer). Both
 * cases below reach the same `listing` phase from one shared, cold-bootstrap `/review?target=…`
 * mount (D40's cold-bootstrap arm — the fixture never answers `repo.list`, so this is the only
 * arm that reaches `listing` at all here) and then diverge.
 */
test.describe('review sidebar interaction', () => {
  let server: InteractionServer;

  test.beforeAll(async () => {
    server = await startInteractionServer({
      reviewTarget: { repoId: FAKE_REPO_ID, branch: FAKE_BRANCH },
    });
  });

  test.afterAll(async () => {
    await server.close();
  });

  async function bootReview(page: import('@playwright/test').Page): Promise<void> {
    await page.addInitScript(buildFakeHostInitScript());
    await page.goto(`${server.url}/review`);
    await expect(page.locator(`[data-testid="review-row-${FAKE_SHA}"]`)).toBeVisible();
  }

  // D10 (item 10): F10's root cause — FileTree.vue's row click never stopped propagation, and
  // ReviewCommitRow.vue's click-to-toggle listener sat on the *whole* row (header and body both),
  // so a click on any file inside an expanded commit bubbled straight up and collapsed the very
  // commit it was clicked inside. Confirmed by hand against a pre-fix tree (git stash the D10
  // hunk of ReviewCommitRow.vue, rerun this spec) that this case fails exactly that way — the row
  // collapses and the assertion below sees aria-expanded="false".
  test('clicking a file inside an expanded commit does not collapse the row', async ({ page }) => {
    await bootReview(page);

    const row = page.locator(`[data-testid="review-row-${FAKE_SHA}"]`);
    await row.locator('.kv-review-row-header').click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');

    const fileRow = page.locator('[data-testid="file-tree"] .kv-file-tree-row', {
      hasText: FAKE_FILE_PATH.split('/').pop(),
    });
    await expect(fileRow).toBeVisible();
    await fileRow.click();

    // The regression this case guards: a click on the file row must never bubble into the
    // commit row's own click-to-toggle listener.
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-testid="file-tree"]')).toBeVisible();
  });

  // G-UX D5 (item 5): F6's exact mechanism, reproduced without VS Code — a document-level click
  // listener (the shape VS Code's own webview link interceptor is registered as, bubble-phase on
  // the document) must actually OBSERVE the click on the "Open in graph" anchor. The old
  // `@click.stop` prevented exactly this, so the interceptor never saw the click and the
  // command: URI was never delivered to the host. The row's own aria-expanded must stay
  // unchanged — the .kv-review-row-actions guard (not a stopped click) is what keeps this from
  // also toggling the row.
  test('Open in graph reaches a document-level listener and does not toggle the row', async ({
    page,
  }) => {
    await bootReview(page);

    const row = page.locator(`[data-testid="review-row-${FAKE_SHA}"]`);
    await expect(row).toHaveAttribute('aria-expanded', 'false');

    await page.evaluate(() => {
      (window as unknown as { __openInGraphClicks: number }).__openInGraphClicks = 0;
      document.addEventListener('click', (event) => {
        const target = event.target as Element | null;
        if (target?.closest('a[aria-label="Open in graph"]')) {
          (window as unknown as { __openInGraphClicks: number }).__openInGraphClicks++;
        }
      });
    });

    await row.locator('a[aria-label="Open in graph"]').click();

    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __openInGraphClicks?: number }).__openInGraphClicks ?? 0,
        ),
      )
      .toBe(1);
    await expect(row).toHaveAttribute('aria-expanded', 'false');
  });

  // D11a (item 11): the corrected, single-step "back to branch selection" — reach the listing
  // phase, click the new back button, and assert the DOM actually returns to the branch-picker
  // screen (ReviewView.vue's own existing data-testid, :503), not merely that
  // ReviewSessionState's internal `branch` ref flipped, which a unit test could already show.
  test('the back button returns to the branch-picker screen', async ({ page }) => {
    await bootReview(page);

    await expect(page.locator('[data-testid="review-no-branch"]')).toHaveCount(0);
    await page.locator('[data-testid="review-back-button"]').click();
    await expect(page.locator('[data-testid="review-no-branch"]')).toBeVisible();
  });
});
