import { expect, type Page, test } from "@playwright/test";

/**
 * `docs/plans/P4.md` W13 — the interaction suite: everything §6.4/§6.2/§5.1.1 describe as a
 * behaviour, exercised against the harness's `mockBridge.ts` (P3 W14, extended P4 W12). Visual
 * regression is `graph.spec.ts`'s job; this file never screenshots.
 */

// `Window.__kiraHarness`'s ambient type is declared once, project-wide, in `shell.spec.ts` —
// see that file's own comment on why this file does not repeat it.

async function ready(page: Page): Promise<void> {
  await page.getByTestId("connection-state").waitFor();
}

/**
 * SlickGrid stamps every row div with a stable `data-row="N"` attribute (its own
 * `appendRowHtml`), but a row's *position among its DOM siblings* is not stable: `invalidateRows`
 * removes a row's node and `render()` re-`appendChild`s a fresh one at the *end* of the row
 * container (positioned back to the right place on screen only via `transform: translateY(...)`)
 * — so once a row has been invalidated even once (a selection change, a layout patch, …),
 * `.slick-row` DOM order no longer matches row order at all. Every test here that needs a
 * *specific* row targets it by `data-row`, never by `.first()`/`.nth()` on `.slick-row`.
 */
function rowByIndex(page: Page, index: number): ReturnType<Page["locator"]> {
  return page.locator(`.slick-row[data-row="${index}"]`);
}

/**
 * `graph.stream` (the mock's replay of `Scenario.commits`, `mockBridge.ts`) delivers a scenario's
 * first page in 500-row chunks, not all at once — a scenario with more than one page's worth of
 * history (`hugeRepo`) is still mid-stream for a little while after `ready()` resolves.
 * `LoadMoreButton.vue`'s `disabled` attribute is a direct read of `GraphViewState.loading`, so
 * "the button exists and isn't disabled" is the one visible signal that the *first* page has
 * fully landed — anything that depends on an exact loaded-row count (End's clamp, "N remaining")
 * needs to wait for it first. Only meaningful for a scenario with more than one page; a fully
 * exhausted scenario never renders this button at all.
 */
async function readyToLoadMore(page: Page): Promise<void> {
  await expect(page.locator(".kv-load-more-button:not([disabled])")).toBeVisible();
}

test.describe("rows and columns", () => {
  test("the clean scenario's tip row renders real subject, author, date and sha text", async ({
    page,
  }) => {
    await page.goto("/?scenario=clean");
    await ready(page);
    const firstRow = rowByIndex(page, 0);

    // `topology.ts`'s `clean` spec ends with "tip:merge" — newest-first, so row 0 is "tip".
    await expect(firstRow.locator(".kv-message-subject")).toHaveText("tip");
    await expect(firstRow.locator(".kv-cell-author")).toHaveText("Kira Fixture");
    // The harness's frozen clock (P4 W12) pins every relative date to a small, stable "Nh".
    await expect(firstRow.locator(".kv-cell-date")).toHaveText(/^\d+h$/);
    await expect(firstRow.locator(".kv-cell-sha")).toHaveText(/^[0-9a-f]{7}$/);
  });

  test(".slick-row count stays bounded at rest and after scrolling hugeRepo to its end", async ({
    page,
  }) => {
    await page.goto("/?scenario=hugeRepo");
    await ready(page);
    await readyToLoadMore(page);
    await expect(rowByIndex(page, 0)).toBeVisible();

    const atRest = await page.locator(".slick-row").count();
    // A materialized-array regression would render every loaded row at once (thousands); the
    // viewport this test runs at fits well under 60 in view plus SlickGrid's own render buffer.
    expect(atRest).toBeLessThan(80);

    await page.evaluate(() => {
      const viewport = document.querySelector(".kv-commit-grid .slick-viewport");
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    });
    await page.waitForTimeout(200);

    const atEnd = await page.locator(".slick-row").count();
    expect(atEnd).toBeLessThan(80);
    expect(atEnd).toBeGreaterThan(0);
  });

  test("the graph column's per-row element count stays bounded", async ({ page }) => {
    await page.goto("/?scenario=badges");
    await ready(page);
    const rows = page.locator(".slick-row");
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    const totalGraphElements = await page.locator(".kv-cell-graph svg *").count();
    // One path per lane colour present in the row plus at most two node shapes (dot + ring) —
    // rowSvg.ts's own doc comment: "~4 elements typical", never one element per graph segment.
    expect(totalGraphElements).toBeLessThan(rowCount * 8);
  });
});

test.describe("selection and keyboard", () => {
  test("click selects; a second click on the same row toggles the detail pane closed", async ({
    page,
  }) => {
    await page.goto("/?scenario=clean");
    await ready(page);
    const firstRow = rowByIndex(page, 0);
    const detail = page.getByTestId("detail-region");

    await firstRow.click();
    await expect(firstRow).toHaveClass(/kv-row-selected/);
    await expect(detail).toBeVisible();
    await expect(detail.locator(".kv-detail-subject")).toHaveText("tip");

    await firstRow.click();
    await expect(detail).toBeHidden();
  });

  test("arrow keys, Home, End, PageUp and PageDown move selection and keep it in view", async ({
    page,
  }) => {
    await page.goto("/?scenario=hugeRepo");
    await ready(page);
    // End's expected landing spot depends on exactly how many rows are loaded (moveSelection
    // clamps to `loadedRows - 1`, CommitGrid.vue) — wait for the first page to fully land first.
    await readyToLoadMore(page);
    const detail = page.getByTestId("detail-region");
    const firstRow = rowByIndex(page, 0);
    await firstRow.click();
    await expect(detail.locator(".kv-detail-subject")).toHaveText("huge-19999");

    await page.keyboard.press("ArrowDown");
    await expect(detail.locator(".kv-detail-subject")).toHaveText("huge-19998");

    await page.keyboard.press("ArrowUp");
    await expect(detail.locator(".kv-detail-subject")).toHaveText("huge-19999");

    // §5.1.1: "explicit load more, never infinite scroll" — only the first page (pageSize=5000
    // rows, hugeRepo's own comment) is loaded yet, so End clamps to row 4999 ("huge-15000"), not
    // all the way to the repo's actual root ("huge-0"); reaching that needs Load more/all first.
    await page.keyboard.press("End");
    await expect(detail.locator(".kv-detail-subject")).toHaveText("huge-15000");
    // "keeps it in view": the newly selected row must actually be visible, not merely selected.
    await expect(page.locator(".slick-row.kv-row-selected")).toBeVisible();

    await page.keyboard.press("Home");
    await expect(detail.locator(".kv-detail-subject")).toHaveText("huge-19999");
    await expect(page.locator(".slick-row.kv-row-selected")).toBeVisible();

    await page.keyboard.press("PageDown");
    // A direct, non-retrying textContent() read here would race the watch-driven re-render (the
    // same one-tick gap `toHaveClass`/`toHaveText` below exist to absorb) — assert through an
    // auto-retrying matcher instead of reading the text out first.
    await expect(detail.locator(".kv-detail-subject")).not.toHaveText("huge-19999");
    await expect(page.locator(".slick-row.kv-row-selected")).toBeVisible();

    await page.keyboard.press("PageUp");
    await expect(detail.locator(".kv-detail-subject")).toHaveText("huge-19999");
  });

  test("Esc closes the detail pane", async ({ page }) => {
    await page.goto("/?scenario=clean");
    await ready(page);
    const detail = page.getByTestId("detail-region");
    await rowByIndex(page, 0).click();
    await expect(detail).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(detail).toBeHidden();
  });
});

test.describe("loading more", () => {
  test("Load more appends one page, keeps the top row and selection, updates remaining, then disappears", async ({
    page,
  }) => {
    await page.goto("/?scenario=hugeRepo");
    await ready(page);
    await readyToLoadMore(page);
    const firstRow = rowByIndex(page, 0);
    await firstRow.click();
    const selectedSubject = await page
      .getByTestId("detail-region")
      .locator(".kv-detail-subject")
      .textContent();
    const topSubjectBefore = await firstRow.locator(".kv-message-subject").textContent();

    const loadMore = page.locator(".kv-load-more-button");
    await expect(loadMore).toBeVisible();
    const labelBefore = await loadMore.textContent();
    expect(labelBefore).toContain("15,000 remaining"); // 20,000 - the first page's 5,000

    await loadMore.click();
    await expect(loadMore).toContainText("10,000 remaining");

    // Unchanged: the top visible row and the selection, per §5.1.1's own "Done when".
    await expect(firstRow.locator(".kv-message-subject")).toHaveText(topSubjectBefore ?? "");
    await expect(page.getByTestId("detail-region").locator(".kv-detail-subject")).toHaveText(
      selectedSubject ?? "",
    );

    // Alt-click loads everything remaining in one go; the button disappears at exhaustion.
    await loadMore.click({ modifiers: ["Alt"] });
    await expect(loadMore).toBeHidden({ timeout: 10_000 });
  });
});

test.describe("refresh", () => {
  test("Refresh re-walks and preserves selection and scroll; a mock refsChanged shows the stale dot", async ({
    page,
  }) => {
    await page.goto("/?scenario=clean");
    await ready(page);
    await rowByIndex(page, 0).click();
    await expect(page.getByTestId("detail-region").locator(".kv-detail-subject")).toHaveText("tip");

    const dot = page.locator(".kv-refresh-dot");
    await expect(dot).toBeHidden();
    await page.evaluate(() => window.__kiraHarness.triggerRefsChanged());
    await expect(dot).toBeVisible();

    await page.locator(".codicon-refresh").click();
    await expect(dot).toBeHidden();
    await expect(page.getByTestId("chunk-source")).toHaveText("git");
    // Selection survives the re-walk (App.vue's pendingSelectionSha mechanism, W11).
    await expect(page.getByTestId("detail-region").locator(".kv-detail-subject")).toHaveText("tip");
    await expect(page.locator(".slick-row.kv-row-selected")).toBeVisible();
  });
});

test.describe("repo picker and git-blocked state", () => {
  test("the repo picker opens a candidate", async ({ page }) => {
    await page.goto("/?scenario=clean");
    await ready(page);

    await page.locator(".kv-repo-trigger").click();
    const list = page.locator(".kv-repo-list");
    await expect(list).toBeVisible();
    const otherCandidate = page.locator(".kv-repo-item", { hasText: "other-repo" });
    await expect(otherCandidate).toBeVisible();

    await otherCandidate.click();
    await expect(list).toBeHidden();
    // Opening a candidate resets the *client's* store and re-opens the stream (App.vue's
    // handleRepoOpened, W11) — but the mock answers with the same one repo either way
    // (`repoOpen`'s own doc comment) and that repo's *session* was never closed, so its rows are
    // still cached host-side: exactly `RepoService.streamGraph`'s "cache" branch, a full replay
    // with no new git read, not the "git" source a genuinely first-ever open gets.
    await expect(page.getByTestId("chunk-source")).toHaveText("cache");
    await expect(rowByIndex(page, 0)).toBeVisible();
  });

  test("the tooOld scenario renders the git-blocked state", async ({ page }) => {
    await page.goto("/?scenario=tooOld");
    await ready(page);

    await expect(page.locator(".codicon-warning")).toBeVisible();
    await expect(page.getByText("Git is too old")).toBeVisible();
    // §4.2: "the repo picker, prompted, and nothing else" — no toolbar in this state.
    await expect(page.locator(".kv-repo-trigger")).toHaveCount(0);
    await expect(page.locator(".slick-row")).toHaveCount(0);
  });
});

test.describe("persistence", () => {
  test("a column resize persists across a reload of the harness page", async ({ page }) => {
    await page.goto("/?scenario=clean");
    await ready(page);

    const readAuthorWidth = () =>
      page.evaluate(() => {
        const raw = sessionStorage.getItem("kira-harness-viewState");
        return raw ? (JSON.parse(raw).columnWidths.author as number) : null;
      });

    const before = await readAuthorWidth();
    expect(before).toBe(140); // DEFAULT_COLUMN_WIDTHS.author

    const handle = page.locator(".kv-resize-handle").first();
    const box = await handle.boundingBox();
    if (!box) throw new Error("no bounding box for the author resize handle");
    await handle.hover();
    await page.mouse.down();
    await page.mouse.move(box.x + 40, box.y);
    await page.mouse.up();

    await expect.poll(readAuthorWidth).not.toBe(before);
    const afterDrag = await readAuthorWidth();

    await page.reload();
    await ready(page);
    expect(await readAuthorWidth()).toBe(afterDrag);
  });
});
