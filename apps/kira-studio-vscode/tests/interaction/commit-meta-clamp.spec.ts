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
 * G-UX D7 (item 7): the harness now mounts the whole `DetailPane.vue` (subject + tree + details),
 * not a bare `CommitMeta.vue` — this file's own cases below need the tree's real geometry
 * (detail-pane-proportion) and the details section's own absence of SHA/parent markup.
 */
test.describe('CommitMeta message-body clamp', () => {
  let server: HarnessServer;

  test.beforeAll(async () => {
    server = await startCommitMetaHarnessServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  test('a long body starts clamped, and "Show more" expands it to its full height', async ({
    page,
  }) => {
    await page.goto(server.url);

    const body = page.locator('.kv-meta-body');
    await expect(body).toBeVisible();

    const toggle = page.locator('.kv-meta-body-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText('Show more');

    const collapsed = await body.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(collapsed.clientHeight, 'collapsed: clamped to a bounded height').toBeGreaterThan(0);
    expect(
      collapsed.scrollHeight,
      'collapsed: the full content is taller than the 4-line clamp',
    ).toBeGreaterThan(collapsed.clientHeight);

    await toggle.click();
    await expect(toggle).toHaveText('Show less');

    const expandedHeight = await body.evaluate((el) => el.clientHeight);
    expect(expandedHeight, 'expanded: the clamp is lifted, full content now visible').toBe(
      collapsed.scrollHeight,
    );
  });

  // G-UX D7 (7a/7b): trailers and the author/committer identity both moved inside the "Show more"
  // collapsible region — hidden entirely while collapsed (the default view), revealed alongside
  // the body the moment it opens.
  test('trailers and the author line are absent while collapsed, and appear together after Show more', async ({
    page,
  }) => {
    await page.goto(server.url);

    await expect(page.locator('.kv-meta-body')).toBeVisible();
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

  // G-UX D7 (7b): the sha and parent rows are gone entirely, not merely hidden — checked in both
  // the collapsed and expanded state, since D7 deleted the markup outright rather than v-if-ing
  // it, so expanding the message section can never bring it back.
  test('the SHA and parent rows are gone from the DOM entirely, collapsed and expanded alike', async ({
    page,
  }) => {
    await page.goto(server.url);

    await expect(page.locator('.kv-meta-sha')).toHaveCount(0);
    await expect(page.locator('.kv-meta-sha-row')).toHaveCount(0);
    await expect(page.locator('.kv-meta-parents')).toHaveCount(0);
    await expect(page.locator('.kv-meta-parent')).toHaveCount(0);

    await page.locator('.kv-meta-body-toggle').click();

    await expect(page.locator('.kv-meta-sha')).toHaveCount(0);
    await expect(page.locator('.kv-meta-sha-row')).toHaveCount(0);
    await expect(page.locator('.kv-meta-parents')).toHaveCount(0);
    await expect(page.locator('.kv-meta-parent')).toHaveCount(0);
  });

  // G-UX D7 (7c): the pane's own 80% file-tree target, measured as real rendered geometry over a
  // fixed 480px pane height (commitMetaHarnessServer.ts's own `#app` height) — this plan's own §2
  // D7 worked example ("at a 480px pane the tree gets ≈82%"). Collapsed only (the default view);
  // the Tier-2 list's own "≥ 0.75" floor, not the exact arithmetic, is what this asserts — a real
  // page's font metrics will never match the plan's own estimate to the pixel.
  test('the file tree occupies at least three quarters of the pane while collapsed', async ({
    page,
  }) => {
    await page.goto(server.url);
    await expect(page.locator('.kv-meta-body')).toBeVisible();

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
