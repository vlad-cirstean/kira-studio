import { expect, test } from '@playwright/test';
import {
  type HarnessServer,
  startCommitMetaHarnessServer,
} from './support/commitMetaHarnessServer.ts';

/**
 * G19 §4.2/D4 (item 4): CommitMeta.vue's message-body clamp — real rendered geometry
 * (`scrollHeight`/`clientHeight`), the same standard this tier's own `webview-layout` project
 * already holds itself to (G16), over a standalone mount rather than the full graph-panel
 * bootstrap (SlickGrid, the layout worker) this one component's own behaviour has no need of.
 *
 * G-UX (items 6/7): the harness mounts the whole `DetailPane.vue` (subject/facts/actions + tree),
 * not a bare `CommitMeta.vue`. `CommitMeta.vue` no longer clamps the body to a couple of lines
 * while collapsed — it hides the body (and everything else besides the title, the date/SHA facts
 * row, and the "Open all changes" action) entirely until "Show more" is clicked, at which point
 * the body renders at its full height alongside identities, trailers, and refs/signature/PR.
 */
test.describe('CommitMeta message-body clamp', () => {
  let server: HarnessServer;

  test.beforeAll(async () => {
    server = await startCommitMetaHarnessServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  test('collapsed shows only the title, the date/SHA facts row, and "Open all changes" — the body is hidden, not clamped', async ({
    page,
  }) => {
    await page.goto(server.url);

    await expect(page.locator('.kv-meta-subject')).toBeVisible();
    await expect(page.locator('[data-testid="open-all-changes-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="commit-meta-sha"]')).toBeVisible();

    const toggle = page.locator('.kv-meta-body-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText('Show more');

    // The body element exists in the DOM (so it need not be freshly mounted on expand — see
    // CommitMeta.vue's own doc comment on why) but is not visible while collapsed.
    await expect(page.locator('.kv-meta-body')).toHaveCount(1);
    await expect(page.locator('.kv-meta-body')).toBeHidden();
    await expect(page.locator('.kv-meta-expanded')).toHaveCount(0);
  });

  test('"Show more" reveals the body at its full height, with no clamp applied', async ({
    page,
  }) => {
    await page.goto(server.url);

    const toggle = page.locator('.kv-meta-body-toggle');
    await toggle.click();
    await expect(toggle).toHaveText('Show less');

    const body = page.locator('.kv-meta-body');
    await expect(body).toBeVisible();
    const { scrollHeight, clientHeight } = await body.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(clientHeight, 'expanded: no clamp — the full content is visible').toBe(scrollHeight);
  });

  // P74 §1.2/§10: the gap "Show more" itself never closed — the toggle flips and the body
  // unhides, but `.kv-detail-pane-meta`'s own `max-height: 20%`/`overflow: hidden` (DetailPane.vue)
  // used to stay fixed regardless, so the newly-unhidden content was clipped with no way to reach
  // it. `--expanded` widens the cap AND switches to `overflow: auto` (this same file's own
  // `.kv-detail-pane-meta.kv-detail-pane-meta--expanded` rule) — a real region, not an unbounded
  // one: this harness's own fixture body (10 paragraphs, deliberately long — see this file's own
  // comment on why) is taller than even the widened cap, so `scrollHeight > clientHeight` here is
  // expected and correct. What must be true instead is that the content is scrollable, not gone:
  // `overflow` is no longer `hidden` once expanded.
  test('"Show more" grows the meta pane and makes its content reachable by scroll, not clipped', async ({
    page,
  }) => {
    await page.goto(server.url);

    const meta = page.locator('.kv-detail-pane-meta');
    const collapsedHeight = await meta.evaluate((el) => el.clientHeight);

    await page.locator('.kv-meta-body-toggle').click();

    const { clientHeight, overflowY } = await meta.evaluate((el) => ({
      clientHeight: el.clientHeight,
      overflowY: getComputedStyle(el).overflowY,
    }));
    expect(
      clientHeight,
      'expanded: the pane itself grew past the collapsed 20% cap',
    ).toBeGreaterThan(collapsedHeight);
    expect(overflowY, 'expanded: content taller than the cap scrolls, it is not clipped away').toBe(
      'auto',
    );
  });

  // P74 §2.1/§10: the harness's own decoration fixture used to be `[]`, so this branch — the Refs
  // row that only renders when `detail.decoration.length > 0` — was never exercised at all.
  test('a commit with a ref decoration shows the Refs row after "Show more"', async ({ page }) => {
    await page.goto(server.url);

    await expect(page.locator('dt', { hasText: 'Refs' })).toHaveCount(0);
    await expect(page.locator('.kv-meta-refs')).toHaveCount(0);

    await page.locator('.kv-meta-body-toggle').click();

    await expect(page.locator('dt', { hasText: 'Refs' })).toBeVisible();
    const refs = page.locator('.kv-meta-refs');
    await expect(refs).toBeVisible();
    await expect(refs).toContainText('main');
  });

  // G-UX (items 6/7): trailers and the author/committer identity both live inside the same
  // "Show more" region as the body now — hidden entirely while collapsed, revealed together the
  // moment it opens.
  test('trailers and the author line are absent while collapsed, and appear together after Show more', async ({
    page,
  }) => {
    await page.goto(server.url);

    await expect(page.locator('.kv-meta-trailers')).toHaveCount(0);
    await expect(page.locator('.kv-meta-identity')).toHaveCount(0);

    await page.locator('.kv-meta-body-toggle').click();

    const trailers = page.locator('.kv-meta-trailers');
    await expect(trailers).toBeVisible();
    await expect(trailers).toContainText('Co-authored-by');
    await expect(trailers).toContainText('Jane Coauthor');
    await expect(trailers).toContainText('Signed-off-by');

    const identity = page.locator('.kv-meta-identity');
    await expect(identity).toHaveCount(2); // author + committer, since the fixture's differ
    await expect(identity.first()).toContainText('Fake Author');
    await expect(identity.last()).toContainText('Fake Committer');
  });

  // G-UX (item 6): the old header copy-message button and the separate SHA/parent rows (from an
  // earlier phase) are both gone — replaced by "Open all changes" and the facts row's own short
  // SHA button, which copies the *full* sha on click and is visible in both states.
  test('the facts row shows a short SHA in both states, with no separate SHA/parent row', async ({
    page,
  }) => {
    await page.goto(server.url);

    await expect(page.locator('[data-testid="commit-meta-sha"]')).toHaveText('2222222');
    await expect(page.locator('.kv-meta-sha-row')).toHaveCount(0);
    await expect(page.locator('.kv-meta-parents')).toHaveCount(0);
    await expect(page.locator('.kv-meta-parent')).toHaveCount(0);

    await page.locator('.kv-meta-body-toggle').click();

    await expect(page.locator('[data-testid="commit-meta-sha"]')).toHaveText('2222222');
    await expect(page.locator('.kv-meta-sha-row')).toHaveCount(0);
    await expect(page.locator('.kv-meta-parents')).toHaveCount(0);
    await expect(page.locator('.kv-meta-parent')).toHaveCount(0);
  });

  // G-UX (items 6/7): the pane's own file-tree proportion, measured as real rendered geometry
  // over a fixed 480px pane height (commitMetaHarnessServer.ts's own `#app` height) — with the
  // body/identities/trailers/details all hidden while collapsed, the header + facts row is a
  // small, fixed cost and the tree gets the large majority of the pane.
  test('the file tree occupies at least three quarters of the pane while collapsed', async ({
    page,
  }) => {
    await page.goto(server.url);
    await expect(page.locator('.kv-meta-subject')).toBeVisible();

    const { paneHeight, treeHeight } = await page.evaluate(() => {
      const pane = document.querySelector('.kv-detail-pane');
      const tree = document.querySelector('.kv-detail-pane-tree');
      if (!pane || !tree) throw new Error('.kv-detail-pane/.kv-detail-pane-tree not found');
      return {
        paneHeight: pane.getBoundingClientRect().height,
        treeHeight: tree.getBoundingClientRect().height,
      };
    });

    expect(paneHeight).toBeGreaterThan(0);
    expect(treeHeight / paneHeight).toBeGreaterThanOrEqual(0.75);
  });
});
