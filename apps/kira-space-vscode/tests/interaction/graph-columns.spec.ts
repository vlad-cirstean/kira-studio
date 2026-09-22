import { expect, test } from '@playwright/test';
import {
  buildFakeGraphHostInitScript,
  FAKE_REPO_ID,
  OTHER_REPO_ID,
} from './support/fakeGraphHost.ts';
import { type InteractionServer, startInteractionServer } from './support/server.ts';

/**
 * G21 D14 (item 14, §7.1/§7.2's own checklist): the grid-shape half of D5/D6 — the SHA column is
 * gone, and the date column is wide enough for its own widest absolute rendering. Both are DOM-
 * level regressions no unit test can see (`columns.ts`'s own definitions are pure data; whether
 * SlickGrid actually mounts four header columns, and how wide it actually lays the date cell out,
 * are facts about the real bundle running in a real page), so this is the interaction tier's own
 * check, over `fakeGraphHost.ts`'s one-commit fixture.
 *
 * `CommitGrid.vue` sets `showColumnHeader: false` (§6.1 — this list has no header row to show),
 * which hides the header *panel*, not the per-column header nodes SlickGrid still creates
 * unconditionally on every render — `.slick-header-column` stays a reliable, real, four-per-grid
 * count regardless (D1/item 1a's compact mode aside — see `bootGraph`'s own note).
 */
test.describe('graph grid columns', () => {
  let server: InteractionServer;

  test.beforeAll(async () => {
    server = await startInteractionServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  // G-UX D1 (item 1a): `App.vue`'s own `detailOpen` ref defaults to `true` (pre-existing,
  // unrelated to this plan) and nothing is persisted in this fixture (`getState()` always
  // returns `undefined`), so a fresh mount's docked pane renders immediately at the wide
  // breakpoint — with nothing selected yet, `hasSelection` gates only its own "Select a commit"
  // placeholder, never `detailOpen` itself. That means a fresh boot ALSO starts in D1's compact
  // (graph+message) column mode. `Escape` (`App.vue`'s own document-level handler) closes it
  // unconditionally, giving every case below a known, closed baseline to start from — the cases
  // that want the pane open drive that transition explicitly, by clicking a row.
  async function bootGraph(page: import('@playwright/test').Page): Promise<void> {
    await page.addInitScript(buildFakeGraphHostInitScript());
    await page.goto(`${server.url}/graph`);
    await expect(
      page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"]'),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="detail-region"]')).toHaveCount(0);
  }

  // D5: the SHA column (and its own copy-on-click button) is deleted outright, not merely hidden
  // — CommitMeta.vue's own single SHA row (G21 D5) is the one place a full sha is shown/copied now.
  test('renders exactly the four remaining columns, with no SHA cell anywhere', async ({
    page,
  }) => {
    await bootGraph(page);

    const headers = page.locator('[data-testid="commit-grid"] .slick-header-column');
    await expect(headers).toHaveCount(4);
    const ids = await headers.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-id')));
    expect(new Set(ids)).toEqual(new Set(['graph', 'message', 'author', 'date']));

    await expect(page.locator('.kv-cell-sha')).toHaveCount(0);
  });

  // D6b: the date column's own floor is measured against `dateFormat.ts`'s widest absolute
  // rendering at the *live* `.kv-cell-date` font, not a hard-coded pixel value that only happens
  // to be right at one font size (F6). The width asserted on is the real `.slick-cell`'s own
  // fixed-width box (the column's actual layout constraint) — `.kv-cell-date` itself is a plain
  // inline `<span>` inside it, which would only ever report its own shrink-to-fit text width.
  test('the date column is at least as wide as its own widest absolute rendering', async ({
    page,
  }) => {
    await bootGraph(page);

    const dateLabel = page
      .locator('[data-testid="commit-grid"] .slick-row[data-row="0"] .kv-cell-date')
      .first();
    await expect(dateLabel).toBeVisible();

    const { cellWidth, measuredWidth } = await dateLabel.evaluate((span) => {
      const cell = span.closest('.slick-cell');
      if (!cell) throw new Error('.kv-cell-date has no ancestor .slick-cell');
      const rect = cell.getBoundingClientRect();
      const style = getComputedStyle(span);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2d canvas context unavailable in this browser');
      ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}/${style.lineHeight} ${style.fontFamily}`;
      // `dateFormat.ts`'s own `formatAbsoluteDate(WIDEST_SAMPLE_TIMESTAMP)` — see
      // `fakeGraphHost.ts`'s doc comment for why this is a literal here, not an import.
      const measured = ctx.measureText('2024-12-30 22:48').width;
      return { cellWidth: rect.width, measuredWidth: measured };
    });

    expect(cellWidth).toBeGreaterThanOrEqual(measuredWidth);
  });

  test('the one loaded row is the fixture commit', async ({ page }) => {
    await bootGraph(page);
    await expect(
      page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"] .kv-cell-message'),
    ).toContainText('Add the graph column fixture');
  });

  // P7 (item 1): row height only grows for a row that actually carries a ref/PR badge, and the
  // graph column's own node sits on the subject line in both cases, not the row's own midpoint —
  // `fakeGraphHost.ts`'s `'oneDecoratedOneNot'` stream mode gives one real undecorated row and one
  // real tag-decorated row to compare directly, rather than asserting a computed number in
  // isolation (that's what `rowSvg.test.ts`'s own unit coverage already does).
  test.describe('row height and graph-node alignment (item 1)', () => {
    async function bootDecoratedGraph(page: import('@playwright/test').Page): Promise<void> {
      await page.addInitScript(buildFakeGraphHostInitScript({ streamMode: 'oneDecoratedOneNot' }));
      await page.goto(`${server.url}/graph`);
      await expect(
        page.locator('[data-testid="commit-grid"] .slick-row[data-row="1"]'),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-testid="detail-region"]')).toHaveCount(0);
    }

    test('an undecorated row is shorter than a row with a ref badge', async ({ page }) => {
      await bootDecoratedGraph(page);

      const plainHeight = await page
        .locator('[data-testid="commit-grid"] .slick-row[data-row="0"]')
        .evaluate((el) => el.getBoundingClientRect().height);
      const decoratedHeight = await page
        .locator('[data-testid="commit-grid"] .slick-row[data-row="1"]')
        .evaluate((el) => el.getBoundingClientRect().height);

      expect(decoratedHeight).toBeGreaterThan(plainHeight);
    });

    // The real regression this guards: the bullet used to sit at the row's own literal midpoint
    // (`rowHeight / 2`), which drifts away from the subject line the taller a decorated row gets.
    // Asserted against the real, rendered subject text box in both rows — not a computed offset —
    // so a future change to the badge/subject CSS is caught here even if the arithmetic in
    // `graphColumn.ts`/`rowSvg.ts` is not itself touched.
    for (const row of [0, 1] as const) {
      test(`row ${row}'s graph node is vertically centred on its own subject line`, async ({
        page,
      }) => {
        await bootDecoratedGraph(page);

        const { nodeCy, subjectMidY, rowTop } = await page.evaluate((rowIndex) => {
          const rowEl = document.querySelector(
            `[data-testid="commit-grid"] .slick-row[data-row="${rowIndex}"]`,
          );
          const circle = rowEl?.querySelector('.kv-graph-svg circle');
          const subject = rowEl?.querySelector('.kv-message-subject');
          if (!rowEl || !circle || !subject) {
            throw new Error(`row ${rowIndex}: missing row/circle/subject element`);
          }
          const rowRect = rowEl.getBoundingClientRect();
          const subjectRect = subject.getBoundingClientRect();
          const cy = Number(circle.getAttribute('cy'));
          return {
            nodeCy: rowRect.top + cy,
            subjectMidY: subjectRect.top + subjectRect.height / 2,
            rowTop: rowRect.top,
          };
        }, row);

        // A couple of px of slack for sub-pixel text-box rounding — the real assertion is that the
        // node sits ON the subject line, not floating 8px above it the way `rowHeight / 2` used to
        // once the row grew a badge track.
        expect(Math.abs(nodeCy - subjectMidY)).toBeLessThanOrEqual(2);
        expect(rowTop).toBeGreaterThanOrEqual(0); // sanity: real geometry, not all-zero in a hidden tab
      });
    }
  });

  // G-UX D2 (item 1b): a click on an unselected row opens the detail pane on the FIRST click, not
  // the second — F2's own regression this guards.
  test('one click on an unselected row opens the detail pane', async ({ page }) => {
    await bootGraph(page);
    await expect(page.locator('[data-testid="detail-region"]')).toHaveCount(0);

    await page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"]').click();

    await expect(page.locator('[data-testid="detail-region"]')).toBeVisible();
  });

  // D2's own second half: the already-selected row still toggles closed by a second click — the
  // only mouse-only way to close the pane (§9's human-eye decision 1).
  test('clicking the already-selected row toggles the pane closed', async ({ page }) => {
    await bootGraph(page);
    const row = page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"]');
    const detailRegion = page.locator('[data-testid="detail-region"]');

    await row.click();
    await expect(detailRegion).toBeVisible();

    await row.click();
    await expect(detailRegion).toHaveCount(0);
  });

  // D2: the whole row reads as clickable now (F2's own "the one clickable cell looks like static
  // text, the rows that are clickable don't" complaint), via ordinary CSS inheritance from
  // `.slick-row`'s own `cursor: pointer` — the date cell is no longer *specially* pointer (its
  // own dedicated rule is gone, per D8), it is pointer for the same reason every other cell in
  // the row now is.
  test('the row and every cell in it, including the date cell, show a pointer cursor', async ({
    page,
  }) => {
    await bootGraph(page);
    const row = page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"]');
    await expect(row).toHaveCSS('cursor', 'pointer');
    await expect(row.locator('.kv-cell-date').first()).toHaveCSS('cursor', 'pointer');
    await expect(row.locator('.kv-cell-message').first()).toHaveCSS('cursor', 'pointer');
  });

  // D8 (item 8): the date-cell click that used to toggle relative/absolute formatting is gone
  // entirely — clicking it now does exactly what clicking anywhere else on the row does (opens
  // the pane; D1 then drops the date column entirely while it is open), and never changes the
  // rendered date text. Closing the pane again (a second click on the now-selected row, D2) brings
  // the date column back, so its text can be re-checked against what it was before either click.
  test('clicking the date cell does not change the rendered date text', async ({ page }) => {
    await bootGraph(page);
    const row = page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"]');
    const dateCellBefore = row.locator('.kv-cell-date').first();
    const before = await dateCellBefore.textContent();

    await dateCellBefore.click();
    await expect(page.locator('[data-testid="detail-region"]')).toBeVisible();

    await row.click();
    await expect(page.locator('[data-testid="detail-region"]')).toHaveCount(0);
    await expect(row.locator('.kv-cell-date').first()).toHaveText(before ?? '');
  });

  // D1 (item 1a): opening the detail pane drops author/date to graph+message only, and
  // `computeMessageWidth` stops reserving their 292px (viewState.ts's own
  // DEFAULT_COLUMN_WIDTHS: author 140 + date 152) — the message cell gets the grid host's ENTIRE
  // remaining width (host width minus the graph column alone), not host-minus-author-minus-date.
  //
  // Deviation from the plan's own Tier-2 wording ("the message cell is at least author+date px
  // wider [when open] than with it closed"): measured directly, that comparison does not hold on
  // a real page — opening the docked aside (DEFAULT_DETAIL_WIDTH, 380px) shrinks
  // `.kv-graph-region`'s own available width by MORE than the 292px D1 frees back to the message
  // column, so the message cell's absolute width is actually smaller open than closed (verified:
  // ~89px smaller at this suite's 1280px viewport). F1's own arithmetic already says as much
  // ("the message column is left roughly 1000-380-292-graph≈300px" — a description of the open
  // state alone, never claimed wider than the closed state). D1's real, checkable promise is that
  // the message column gets 100% of the remaining host width once compact, which is what this
  // case asserts instead.
  test('the detail pane open compacts the grid to graph+message, and the message cell takes the whole remaining width', async ({
    page,
  }) => {
    await bootGraph(page);

    await page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"]').click();
    await expect(page.locator('[data-testid="detail-region"]')).toBeVisible();

    const headers = page.locator('[data-testid="commit-grid"] .slick-header-column');
    await expect(headers).toHaveCount(2);
    const ids = await headers.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-id')));
    expect(new Set(ids)).toEqual(new Set(['graph', 'message']));

    const { hostWidth, graphWidth, messageWidth } = await page.evaluate(() => {
      const host = document.querySelector('[data-testid="commit-grid"] .kv-grid-host');
      const graphCell = document
        .querySelector('[data-testid="commit-grid"] .slick-row[data-row="0"] .kv-cell-graph')
        ?.closest('.slick-cell');
      const messageCell = document
        .querySelector('[data-testid="commit-grid"] .slick-row[data-row="0"] .kv-cell-message')
        ?.closest('.slick-cell');
      if (!host || !graphCell || !messageCell) {
        throw new Error('grid host / graph cell / message cell not found');
      }
      return {
        hostWidth: host.clientWidth,
        graphWidth: graphCell.getBoundingClientRect().width,
        messageWidth: messageCell.getBoundingClientRect().width,
      };
    });

    // A couple of px of slack for borders/rounding — no author/date-sized (292px) gap should
    // remain unaccounted for between the host width and graph+message.
    expect(hostWidth - graphWidth - messageWidth).toBeLessThanOrEqual(4);
  });

  // G-UX D10 (item 2): the graph follows the same repo.changed/refsChanged watcher every other
  // client state class already subscribes to — no click, no manual refresh.
  test.describe('auto-refresh on repo.changed', () => {
    function refreshCalls(page: import('@playwright/test').Page): Promise<unknown[]> {
      return page.evaluate(
        () => (window as { __graphRefreshCalls?: unknown[] }).__graphRefreshCalls ?? [],
      );
    }

    function emitRepoChanged(
      page: import('@playwright/test').Page,
      kind: 'refsChanged' | 'worktreeChanged',
      repoId?: string,
    ): Promise<void> {
      return page.evaluate(
        ({ kind, repoId }) =>
          (
            window as {
              __emitRepoChanged?: (kind: string, repoId?: string) => void;
            }
          ).__emitRepoChanged?.(kind, repoId),
        { kind, repoId },
      );
    }

    test('a refsChanged event for the open repo triggers graph.refresh within 1s, with no click', async ({
      page,
    }) => {
      await bootGraph(page);
      expect(await refreshCalls(page)).toHaveLength(0);

      await emitRepoChanged(page, 'refsChanged', FAKE_REPO_ID);

      await expect.poll(() => refreshCalls(page), { timeout: 1000 }).toHaveLength(1);
    });

    test('a worktreeChanged event never triggers graph.refresh', async ({ page }) => {
      await bootGraph(page);

      await emitRepoChanged(page, 'worktreeChanged', FAKE_REPO_ID);
      // No affirmative signal that "nothing will ever happen" exists — wait past the auto-refresh
      // window (250ms coalesce) and assert nothing fired.
      await page.waitForTimeout(600);

      expect(await refreshCalls(page)).toHaveLength(0);
    });

    test('a refsChanged event for a different repoId never triggers graph.refresh', async ({
      page,
    }) => {
      await bootGraph(page);

      await emitRepoChanged(page, 'refsChanged', OTHER_REPO_ID);
      await page.waitForTimeout(600);

      expect(await refreshCalls(page)).toHaveLength(0);
    });

    // With only the fixture's one row loaded, `.slick-viewport`'s `scrollTop` is 0 both before and
    // after — a real regression (the viewport jumping to the top on refresh) would only be
    // observable with a scrolled, many-row grid, which is outside this narrowly-scoped fixture's
    // own one-commit shape (`fakeGraphHost.ts`'s own doc comment). Asserted anyway, honestly, for
    // what it is: the auto-refresh settling must not leave scrollTop in a different, un-pinned
    // state.
    test('the viewport scroll position is preserved across an auto-refresh', async ({ page }) => {
      await bootGraph(page);
      const viewport = page.locator('[data-testid="commit-grid"] .slick-viewport').first();
      const before = await viewport.evaluate((el) => el.scrollTop);

      await emitRepoChanged(page, 'refsChanged', FAKE_REPO_ID);
      await expect.poll(() => refreshCalls(page), { timeout: 1000 }).toHaveLength(1);
      await expect(
        page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"]'),
      ).toBeVisible();

      const after = await viewport.evaluate((el) => el.scrollTop);
      const rowHeight = await page
        .locator('[data-testid="commit-grid"] .slick-row[data-row="0"]')
        .evaluate((el) => el.getBoundingClientRect().height);
      expect(Math.abs(after - before)).toBeLessThanOrEqual(rowHeight);
    });
  });

  // G32 round-3 performance review, finding #7: `CommitGrid.vue`'s own `handleChunkLayout` used to
  // call `rebuildColumns()` — a real SlickGrid `setColumns()` structural rebuild, which destroys
  // and recreates every `.slick-header-column` node from scratch (`createColumnHeaders()`'s own
  // `Utils.emptyElement` + rebuild, confirmed against `node_modules/slickgrid`'s own source) — on
  // EVERY streamed chunk, even when the chunk's own lane count had not changed since the previous
  // rebuild. `fakeGraphHost.ts`'s own `'twoChunksSameLane'` stream mode holds its second chunk
  // back until the test calls `window.__releaseSecondGraphChunk()`, giving this test a real pause
  // point to stamp a marker attribute onto the header nodes right after the first chunk's own
  // (correct, lane-count-establishing) rebuild but before the second, same-lane (0) chunk lands —
  // if the second chunk still triggers a rebuild, `createColumnHeaders()` wipes the marker along
  // with the rest of the old header nodes.
  test.describe('column rebuild is gated on lane count actually changing', () => {
    test('a second chunk at the same lane count does not rebuild the header columns', async ({
      page,
    }) => {
      await page.addInitScript(buildFakeGraphHostInitScript({ streamMode: 'twoChunksSameLane' }));
      await page.goto(`${server.url}/graph`);
      await expect(
        page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"]'),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-testid="detail-region"]')).toHaveCount(0);

      const headers = page.locator('[data-testid="commit-grid"] .slick-header-column');
      await expect(headers).toHaveCount(4);
      await headers.evaluateAll((nodes) => {
        for (const node of nodes) node.setAttribute('data-rebuild-marker', 'still-here');
      });

      await page.evaluate(() =>
        (window as { __releaseSecondGraphChunk?: () => void }).__releaseSecondGraphChunk?.(),
      );
      await expect(
        page.locator('[data-testid="commit-grid"] .slick-row[data-row="1"]'),
      ).toBeVisible();

      await expect(headers).toHaveCount(4);
      const stillMarked = await headers.evaluateAll(
        (nodes) =>
          nodes.filter((n) => n.getAttribute('data-rebuild-marker') === 'still-here').length,
      );
      expect(stillMarked).toBe(4);
    });
  });

  // P92 §12.2 item 1: the graph column's own drag handle — previously only author/date had one,
  // so this was the one column whose width a user could never control, and the one that grew on
  // its own with branch count.
  test.describe('graph column resize (item 1)', () => {
    function cellRect(
      page: import('@playwright/test').Page,
      cellClass: string,
    ): Promise<{ width: number; right: number }> {
      return page.evaluate((cls) => {
        const cell = document
          .querySelector(`[data-testid="commit-grid"] .slick-row[data-row="0"] .${cls}`)
          ?.closest('.slick-cell');
        if (!cell) throw new Error(`${cls}: no ancestor .slick-cell`);
        const rect = cell.getBoundingClientRect();
        return { width: rect.width, right: rect.right };
      }, cellClass);
    }

    test('a resize handle exists for the graph column, defaults to <=95px', async ({ page }) => {
      await bootGraph(page);
      const handle = page.locator('[aria-label="Resize graph column"]');
      await expect(handle).toBeVisible();

      const graph = await cellRect(page, 'kv-cell-graph');
      expect(graph.width).toBeLessThanOrEqual(95);
    });

    // Starts by widening (ArrowRight) rather than narrowing straight away — this fixture's own
    // one-lane seed (30px) sits below the shared 40px resize floor, so the first press or two
    // would only clamp back up to the floor rather than move linearly. Four widens land solidly
    // above the floor; the two narrows that follow are then unambiguous.
    test('dragging the handle narrows the graph column and widens the message column by the same amount, with every graph svg staying inside its own cell', async ({
      page,
    }) => {
      await bootGraph(page);
      const handle = page.locator('[aria-label="Resize graph column"]');
      await handle.focus();
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');

      const wideGraph = await cellRect(page, 'kv-cell-graph');
      const wideMessage = await cellRect(page, 'kv-cell-message');

      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');

      const narrowGraph = await cellRect(page, 'kv-cell-graph');
      const narrowMessage = await cellRect(page, 'kv-cell-message');

      const narrowedBy = wideGraph.width - narrowGraph.width;
      expect(narrowedBy).toBeGreaterThan(0);
      // A couple of px of slack for rounding — §1's own arithmetic (messageWidth = hostWidth -
      // graph - reserved) means the message column gains back exactly what the graph column gave up.
      expect(Math.abs(narrowMessage.width - wideMessage.width - narrowedBy)).toBeLessThanOrEqual(2);

      // The regression this guards: the svg used to size itself from laneCount, not the column's
      // actual (now user-set) width, so a narrowed column could leave its svg bleeding into the
      // message column next to it.
      const svgFits = await page.evaluate(() => {
        const svgs = Array.from(
          document.querySelectorAll('[data-testid="commit-grid"] .kv-graph-svg'),
        );
        return (
          svgs.length > 0 &&
          svgs.every((svg) => {
            const cell = svg.closest('.slick-cell');
            return (
              cell !== null &&
              svg.getBoundingClientRect().right <= cell.getBoundingClientRect().right + 1
            );
          })
        );
      });
      expect(svgFits).toBe(true);
    });
  });

  // P92 §12.2 item 2: column widths used to sum to exactly host.clientWidth, but SlickGrid lays
  // its canvas out against the viewport's own content box (narrower once a vertical scrollbar
  // takes layout space) — producing a permanent bogus horizontal scrollbar. Needs enough rows for
  // a real vertical scrollbar to appear; `fakeGraphHost.ts`'s other fixtures (one or two rows)
  // cannot reproduce it.
  test.describe('viewport sizing (item 2)', () => {
    test('the grid never grows a horizontal scrollbar once a vertical one appears, at the default width and after toggling the detail pane', async ({
      page,
    }) => {
      await page.addInitScript(buildFakeGraphHostInitScript({ streamMode: 'manyRows' }));
      await page.goto(`${server.url}/graph`);
      await expect(
        page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"]'),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-testid="detail-region"]')).toHaveCount(0);

      const viewport = page.locator('[data-testid="commit-grid"] .slick-viewport').first();
      // Lane layout runs off the main thread (`layoutClient.ts`), so `loadedRows` — and the
      // canvas height SlickGrid sizes from it — settles asynchronously after all 300 chunks have
      // been dispatched, not synchronously with them. Sanity: this fixture's whole point is a
      // real vertical scrollbar — without one, the assertion below would pass trivially and catch
      // nothing.
      await expect
        .poll(() => viewport.evaluate((el) => el.scrollHeight > el.clientHeight), {
          timeout: 5000,
        })
        .toBe(true);

      const overflowAtDefault = await viewport.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflowAtDefault).toBeLessThanOrEqual(0);

      // A rebuild trigger (compact <-> full column set) is the other moment this regression could
      // reappear, not just first mount.
      await page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"]').click();
      await expect(page.locator('[data-testid="detail-region"]')).toBeVisible();
      await page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"]').click();
      await expect(page.locator('[data-testid="detail-region"]')).toHaveCount(0);

      const overflowAfterToggle = await viewport.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflowAfterToggle).toBeLessThanOrEqual(0);
    });
  });

  // P92 §12.2 item 4: SlickGrid's row-position index only rebuilds inside updateRowCount() — a
  // row whose height flipped after it was already rendered (a badge landing after first paint)
  // left every row below it at a stale transform, painting two rows into one band.
  test.describe('row reposition after a height change (item 4)', () => {
    test('a row whose height grows after first render repositions every row below it, with no overlap', async ({
      page,
    }) => {
      await page.addInitScript(
        buildFakeGraphHostInitScript({ streamMode: 'twoChunksSecondDecorated' }),
      );
      await page.goto(`${server.url}/graph`);
      await expect(
        page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"]'),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-testid="detail-region"]')).toHaveCount(0);

      await page.evaluate(() =>
        (window as { __releaseSecondGraphChunk?: () => void }).__releaseSecondGraphChunk?.(),
      );
      await expect(
        page.locator('[data-testid="commit-grid"] .slick-row[data-row="1"]'),
      ).toBeVisible();

      const rows = await page.evaluate(() => {
        const nodes = Array.from(
          document.querySelectorAll('[data-testid="commit-grid"] .slick-row'),
        );
        return nodes
          .map((el) => {
            const rect = el.getBoundingClientRect();
            return { row: Number(el.getAttribute('data-row')), top: rect.top, bottom: rect.bottom };
          })
          .sort((a, b) => a.row - b.row);
      });

      expect(rows.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].top).toBeGreaterThan(rows[i - 1].top);
        // No overlap — the previous row's own bottom edge is at or before the next row's top,
        // with a hairline of slack for sub-pixel rounding.
        expect(rows[i].top).toBeGreaterThanOrEqual(rows[i - 1].bottom - 1);
      }
    });
  });

  // P92 §12.2 item 10: every badge kind used to paint an opaque background — now an outline only,
  // the label/icon staying the theme's own --kv-badge-fg token.
  test.describe('ref/tag badges render as outlines (item 10)', () => {
    test("a tag badge's background is transparent, its border carries the colour, and its icon matches the badge's own text colour", async ({
      page,
    }) => {
      await page.addInitScript(buildFakeGraphHostInitScript({ streamMode: 'oneDecoratedOneNot' }));
      await page.goto(`${server.url}/graph`);
      await expect(
        page.locator('[data-testid="commit-grid"] .slick-row[data-row="1"]'),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-testid="detail-region"]')).toHaveCount(0);

      const badge = page
        .locator('[data-testid="commit-grid"] .slick-row[data-row="1"] .kv-badge-tag')
        .first();
      await expect(badge).toBeVisible();

      const { backgroundColor, borderColor, badgeColor, iconColor } = await badge.evaluate((el) => {
        const style = getComputedStyle(el);
        const icon = el.querySelector('.kv-badge-icon');
        if (!icon) throw new Error('.kv-badge-tag has no .kv-badge-icon child');
        return {
          backgroundColor: style.backgroundColor,
          borderColor: style.borderColor,
          badgeColor: style.color,
          iconColor: getComputedStyle(icon).color,
        };
      });

      expect(backgroundColor).toMatch(/^(rgba\(0,\s*0,\s*0,\s*0\)|transparent)$/);
      expect(borderColor).not.toMatch(/^(rgba\(0,\s*0,\s*0,\s*0\)|transparent)$/);
      expect(iconColor).toBe(badgeColor);
    });
  });
});
