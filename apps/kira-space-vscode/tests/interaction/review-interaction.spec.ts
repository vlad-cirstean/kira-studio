import { expect, test } from '@playwright/test';
import {
  buildFakeHostInitScript,
  FAKE_BRANCH,
  FAKE_FILE_PATH,
  FAKE_REPO_ID,
  FAKE_REVIEW_FILE_FULL,
  FAKE_REVIEW_FILE_NONE,
  FAKE_REVIEW_FILE_PARTIAL,
  FAKE_SHA,
} from './support/fakeReviewHost.ts';
import { type InteractionServer, startInteractionServer } from './support/server.ts';

/**
 * G19 §4.2/§8.4: the review sidebar's interaction tier, over the narrowly-scoped fake-transport
 * fixture (`fakeReviewHost.ts` — hand-written responses, not a general mock RPC layer). Every case
 * below reaches the same `listing` phase from one shared, cold-bootstrap `/review?target=…` mount
 * (D40's cold-bootstrap arm — the fixture never answers `repo.list`, so this is the only arm that
 * reaches `listing` at all here) and then diverges.
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

  // P75 §1/§8: the collapsed-row bug this guards against — `openAllChanges` used to read its
  // whole action bundle off `expansion?.actions`, `undefined` until the row had been expanded at
  // least once, so a collapsed row's own "Open all changes" reached nothing at all. The row here
  // is never expanded (aria-expanded stays "false" throughout), which is the point: the row-level
  // `rowActions` bundle (`ReviewSessionState.setTarget`) must already be reachable before that.
  test('"Open all changes" on a collapsed row sends editor.openAllChanges', async ({ page }) => {
    await bootReview(page);

    const row = page.locator(`[data-testid="review-row-${FAKE_SHA}"]`);
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await row.hover(); // reveals .kv-review-row-actions (opacity: 0 until hover/focus-within).
    await row.locator('button[aria-label="Open all changes"]').click();

    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __openAllChangesCalls: unknown[] }).__openAllChangesCalls,
        ),
      )
      .toEqual([{ repoId: FAKE_REPO_ID, sha: FAKE_SHA, parentIndex: undefined }]);
    await expect(page.locator('[data-testid="live-announcements"]')).toHaveText('Opened 2 files');
    await expect(row).toHaveAttribute('aria-expanded', 'false');
  });

  // P75 §2.3: replaces the old command:kiraVersion.openCommitInGraph anchor — inert in Kira
  // Studio's Wails WebView, which has no command: handler at any layer (SPEC's own original guess
  // for this row's dead affordance). The real cause was VS Code-only wiring in a shared component;
  // the fix is one request both hosts answer locally, asserted here as a plain bridge call.
  test('"Open in graph" sends graph.revealCommit with the row\'s sha', async ({ page }) => {
    await bootReview(page);

    const row = page.locator(`[data-testid="review-row-${FAKE_SHA}"]`);
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await row.hover();
    await row.locator('button[aria-label="Open in graph"]').click();

    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __revealCommitCalls: unknown[] }).__revealCommitCalls,
        ),
      )
      .toEqual([{ repoId: FAKE_REPO_ID, sha: FAKE_SHA }]);
    await expect(row).toHaveAttribute('aria-expanded', 'false');
  });

  // P75 §4: the tri-state checkbox — a native `:checked`/`:indeterminate` pair, not a third colour
  // on a two-state toggle button (the control this replaced). `review.files`'s three fixture rows
  // (none/partial/full) exercise all three DOM states at once.
  test("the Files pane's reviewed control is a checkbox with three states", async ({ page }) => {
    await bootReview(page);

    await page.locator('.kv-review-toolbar [aria-label^="Files"]').click();

    const noneRow = page.locator('.kv-review-files-tree .kv-file-tree-row', {
      hasText: FAKE_REVIEW_FILE_NONE.split('/').pop(),
    });
    const partialRow = page.locator('.kv-review-files-tree .kv-file-tree-row', {
      hasText: FAKE_REVIEW_FILE_PARTIAL.split('/').pop(),
    });
    const fullRow = page.locator('.kv-review-files-tree .kv-file-tree-row', {
      hasText: FAKE_REVIEW_FILE_FULL.split('/').pop(),
    });

    const noneBox = noneRow.locator('input[type="checkbox"]');
    const partialBox = partialRow.locator('input[type="checkbox"]');
    const fullBox = fullRow.locator('input[type="checkbox"]');

    await expect(noneBox).not.toBeChecked();
    await expect(noneBox).toHaveJSProperty('indeterminate', false);

    await expect(partialBox).not.toBeChecked();
    await expect(partialBox).toHaveJSProperty('indeterminate', true);

    await expect(fullBox).toBeChecked();
    await expect(fullBox).toHaveJSProperty('indeterminate', false);
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
