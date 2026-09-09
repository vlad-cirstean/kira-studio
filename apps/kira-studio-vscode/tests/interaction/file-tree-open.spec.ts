import { expect, test } from '@playwright/test';
import {
  buildFakeHostInitScript,
  FAKE_BRANCH,
  FAKE_FILE_PATH,
  FAKE_FILE_PATH_2,
  FAKE_REPO_ID,
  FAKE_SHA,
} from './support/fakeReviewHost.ts';
import { type InteractionServer, startInteractionServer } from './support/server.ts';

/**
 * G21 D14 (item 14, D13's own file-tree open contract): "which options argument was passed" to
 * `editor.openDiff` is not observable at the unit tier — `FileTree.vue`'s emits are asserted there
 * already, but whether a real click actually reaches `editor.openDiff` with the right `pinned`
 * value needs a real page and a recording fake of that one method (`fakeReviewHost.ts`'s own
 * `window.__openDiffCalls`, `editor.openDiff` answered rather than left pending so `openInEditor`'s
 * own `await` resolves and the next gesture in the same test can proceed).
 *
 * Reuses `review-interaction.spec.ts`'s own cold-bootstrap-to-`listing` shape and its one expanded
 * commit row's file tree (`FAKE_FILE_PATH`, the row's only file) — a fresh `page` per `test`, so
 * `window.__openDiffCalls` never carries a call over from a previous case.
 */
test.describe('file tree open gestures', () => {
  let server: InteractionServer;

  test.beforeAll(async () => {
    server = await startInteractionServer({
      reviewTarget: { repoId: FAKE_REPO_ID, branch: FAKE_BRANCH },
    });
  });

  test.afterAll(async () => {
    await server.close();
  });

  /** Boots the review sidebar and expands the one commit row, landing on its file tree with
   *  `FAKE_FILE_PATH` visible — switched to Flat view first, so this single file is row index 0
   *  (tree mode nests it a level down, under `FAKE_FILE_PATH`'s own directory, which the Enter
   *  case below cares about: `FileTree.vue`'s `focusedRow` starts at `0` and is not itself moved
   *  by real DOM `.focus()`, only by this component's own click/arrow-key handlers, so index 0
   *  has to already *be* the file for a bare `.focus()` + `Enter` to land on it with no preceding
   *  arrow-key navigation of its own). Returns that row's locator; callers drive the actual
   *  click/dblclick/`Enter` gesture. */
  async function openFileRow(
    page: import('@playwright/test').Page,
  ): Promise<import('@playwright/test').Locator> {
    await page.addInitScript(buildFakeHostInitScript());
    await page.goto(`${server.url}/review`);
    await expect(page.locator(`[data-testid="review-row-${FAKE_SHA}"]`)).toBeVisible();

    await page.locator(`[data-testid="review-row-${FAKE_SHA}"] .kv-review-row-header`).click();
    const fileRow = page.locator('[data-testid="file-tree"] .kv-file-tree-row', {
      hasText: FAKE_FILE_PATH.split('/').pop(),
    });
    await expect(fileRow).toBeVisible();

    await page.getByRole('button', { name: 'Flat view' }).click();
    await expect(fileRow).toHaveAttribute('tabindex', '0');
    return fileRow;
  }

  function openDiffCalls(page: import('@playwright/test').Page): Promise<{ pinned: boolean }[]> {
    return page.evaluate(
      () => (window as { __openDiffCalls?: { pinned: boolean }[] }).__openDiffCalls ?? [],
    );
  }

  test('a single click opens one preview (unpinned) diff', async ({ page }) => {
    const fileRow = await openFileRow(page);

    await fileRow.click();

    await expect.poll(() => openDiffCalls(page)).toHaveLength(1);
    const calls = await openDiffCalls(page);
    expect(calls[0].pinned).toBe(false);
  });

  // A real double click fires two native `click` events before its own `dblclick` (per the UI
  // Events spec — `FileTree.vue`'s own doc comment on `onRowDblClick` relies on exactly this:
  // "the browser firing `click` first"), so the recorded sequence ends with one pinned open, with
  // at least one unpinned preview open ahead of it — not literally two calls total.
  test('a double click opens a preview, then a pinned, diff', async ({ page }) => {
    const fileRow = await openFileRow(page);

    await fileRow.dblclick();

    await expect.poll(async () => (await openDiffCalls(page)).at(-1)?.pinned).toBe(true);
    const calls = await openDiffCalls(page);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.slice(0, -1).some((call) => call.pinned === false)).toBe(true);
  });

  test('Enter on the focused row opens one pinned diff, with no preceding preview', async ({
    page,
  }) => {
    const fileRow = await openFileRow(page);

    // Focus only — no click, so no preview open precedes the Enter's own pinned one (unlike the
    // double-click case above, this gesture never touches the row with the mouse at all).
    await fileRow.focus();
    await page.keyboard.press('Enter');

    await expect.poll(() => openDiffCalls(page)).toHaveLength(1);
    const calls = await openDiffCalls(page);
    expect(calls[0].pinned).toBe(true);
  });

  // G-UX D3 (item 3): two files with different extensions get different seti icons — rendered as
  // a CSS mask (`.kv-file-tree-icon`'s own `mask-image`) with `background-color` driving the
  // colour, replacing codicons' one shared `codicon-file-code` glyph for every source language.
  test('two files with different extensions render different seti icons', async ({ page }) => {
    await openFileRow(page);
    const row1 = page.locator('[data-testid="file-tree"] .kv-file-tree-row', {
      hasText: FAKE_FILE_PATH.split('/').pop(),
    });
    const row2 = page.locator('[data-testid="file-tree"] .kv-file-tree-row', {
      hasText: FAKE_FILE_PATH_2.split('/').pop(),
    });
    await expect(row2).toBeVisible();

    const [icon1, icon2] = await Promise.all(
      [row1, row2].map((row) =>
        row.locator('.kv-file-tree-icon').evaluate((el) => {
          const style = getComputedStyle(el);
          return {
            maskImage: style.maskImage || style.getPropertyValue('-webkit-mask-image'),
            backgroundColor: style.backgroundColor,
          };
        }),
      ),
    );

    expect(icon1.maskImage).not.toBe('');
    expect(icon1.maskImage).not.toBe('none');
    expect(icon1.maskImage).not.toBe(icon2.maskImage);
    expect(icon1.backgroundColor).not.toBe(icon2.backgroundColor);
  });

  // G-UX D6 (item 6): the status letter shrinks to the tree's own secondary scale — strictly
  // smaller than the row's own (inherited) font size, so it reads as metadata beside the
  // filename, not as a heading.
  test('the status letter is smaller than the row', async ({ page }) => {
    const fileRow = await openFileRow(page);

    const { statusFontSize, rowFontSize } = await fileRow.evaluate((row) => {
      const status = row.querySelector('.kv-file-tree-status');
      if (!status) throw new Error('.kv-file-tree-status not found');
      return {
        statusFontSize: Number.parseFloat(getComputedStyle(status).fontSize),
        rowFontSize: Number.parseFloat(getComputedStyle(row).fontSize),
      };
    });

    expect(statusFontSize).toBeLessThan(rowFontSize);
  });
});
