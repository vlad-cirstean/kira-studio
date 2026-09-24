import { expect, test } from '@playwright/test';
import {
  buildFakeHostInitScript,
  FAKE_BRANCH,
  FAKE_REPO_ID,
  OTHER_REPO_ID,
} from './support/fakeReviewHost.ts';
import { type InteractionServer, startInteractionServer } from './support/server.ts';

/**
 * P108 F6 regression: `ReviewView.vue`'s `bootstrap()` — when no cold-bootstrap `target` prop is
 * set — awaits `repo.list`, then unconditionally does `repoId.value = list.activeRepoId`. A
 * `review.target` push (the `bridge.on('review.target', ...)` handler registered just above,
 * already live) landing during that await already resolved a completely different repo/branch via
 * `applyTarget` — overwriting `repoId` with the workspace's own default afterwards leaves `review`
 * holding the pushed repo/branch while `repoId` (and everything keyed on it, `refsState` among it)
 * points at the wrong one.
 *
 * Fixed by bailing out of the `repo.list` fallback once `repoId.value` is no longer `undefined` —
 * a push already claimed it.
 */
test.describe('ReviewView bootstrap vs. a review.target push (P108 F6)', () => {
  let server: InteractionServer;

  test.beforeAll(async () => {
    server = await startInteractionServer({ reviewTarget: null });
  });

  test.afterAll(async () => {
    await server.close();
  });

  test('a review.target push during repo.list wins — repoId is never overwritten by the workspace default', async ({
    page,
  }) => {
    await page.addInitScript(buildFakeHostInitScript({ repoListDeferred: true }));
    await page.goto(`${server.url}/review`);

    // bootstrap() has reached its `repo.list` await and is holding for this test's own release.
    await page.waitForFunction(() => typeof (window as any).__resolveRepoList === 'function');

    // The push lands first, resolving entirely (applyTarget + its own review.resolveBase round
    // trip) while repo.list is still pending.
    await page.evaluate(
      ([repoId, branch]) => (window as any).__emitReviewTarget(repoId, branch),
      [FAKE_REPO_ID, FAKE_BRANCH],
    );
    const branchName = page.locator('[data-testid="review-branch-name"]');
    await expect(branchName).toHaveText(FAKE_BRANCH);

    // Only now does repo.list resolve, naming a DIFFERENT repo as the workspace's own active one.
    await page.evaluate(
      (otherRepoId) => (window as any).__resolveRepoList(otherRepoId),
      OTHER_REPO_ID,
    );

    // Give bootstrap's own continuation a turn to run (and, pre-fix, to wrongly re-seed
    // `refsState` against `OTHER_REPO_ID`) before asserting nothing changed.
    await page.waitForTimeout(200);

    await expect(branchName).toHaveText(FAKE_BRANCH);
    const refsListCalls = await page.evaluate(() => (window as any).__refsListCalls);
    // Every refs.list call named FAKE_REPO_ID (the pushed target) — never OTHER_REPO_ID (the
    // workspace's own default the fix must not fall back to once a push already won).
    expect(refsListCalls.some((p: { repoId: string }) => p.repoId === OTHER_REPO_ID)).toBe(false);
    expect(refsListCalls.some((p: { repoId: string }) => p.repoId === FAKE_REPO_ID)).toBe(true);
  });
});
