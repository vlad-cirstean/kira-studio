import type { Locator, Page } from '@playwright/test';

// P22 Pass B, §7.2 — the ~7 locator helpers every grid-touching spec used to redefine locally,
// resolved for whichever engine the fixture booted. `ENGINE` reads the same env var
// `KIRA_GRID_ENGINE=slick bun run test:ui` sets; `fixtures.ts` reads it too, to install
// `window.__kiraGridEngine = 'slick'` before the app's first navigation (the exact pattern
// `slick-grid.spec.ts`'s own `forceSlickEngine` already proved works).
//
// Why most of these need an engine branch at all, and why some don't: SlickGrid's own
// `appendRowHtml` clones the row div per frozen pane (F4, P22-slickgrid-pass-b.md §2) — with
// `frozenColumn: 0` a row's `.slick-row` exists TWICE (the gutter's left-pane clone and the data
// cells' right-pane clone), both carrying the same `data-row`, while `.slick-cell` exists once.
// `data-testid="grid-row"` is written onto the right pane only (`SlickGridHost.vue`'s own
// `onRendered` pass, D10), so a plain `[data-testid="grid-row"][data-row="N"]` selector already
// resolves to exactly one element under either engine with no branch needed — only the cell/gutter
// selectors, which must additionally scope into the correct pane, need one.
export const ENGINE: 'tanstack' | 'slick' =
  process.env.KIRA_GRID_ENGINE === 'slick' ? 'slick' : 'tanstack';

const RIGHT_PANE = '.grid-canvas-top.grid-canvas-right';

/** A data cell, addressed the way every other subsystem addresses one: a page row plus a display
 *  column name. */
export function gridCell(page: Page, row: number, column: string): Locator {
  if (ENGINE === 'slick') {
    return page.locator(
      `[data-testid="data-grid"] ${RIGHT_PANE} [data-testid="grid-row"][data-row="${row}"] [data-testid="grid-cell"][data-column="${column}"]`,
    );
  }
  return page.locator(`[data-testid="grid-cell"][data-row="${row}"][data-column="${column}"]`);
}

export async function cellText(page: Page, row: number, column: string): Promise<string> {
  return (await gridCell(page, row, column)).innerText();
}

/** The gutter (row-number) cell for one page row. Under SlickGrid the gutter lives in the frozen
 *  left pane, which carries no `data-testid="grid-row"` of its own (F4/D10) — `data-row` is still
 *  written on both panes, and only the left pane has a `[data-testid="grid-gutter-cell"]`
 *  descendant, so the combination is unambiguous without a right/left-pane prefix. */
export function gutterCell(page: Page, row: number): Locator {
  if (ENGINE === 'slick') {
    return page.locator(
      `[data-testid="data-grid"] .slick-row[data-row="${row}"] [data-testid="grid-gutter-cell"]`,
    );
  }
  return page.locator('[data-testid="grid-gutter-cell"]').nth(row);
}

/** A data column's header cell — same `data-testid`/`data-column` surface on both engines
 *  (`headerCellAttrs`, D2), so no engine branch is needed here at all. */
export function headerCell(page: Page, column: string): Locator {
  return page.locator(`[data-testid="grid-header-cell"][data-column="${column}"]`);
}

/** A whole rendered row, by page row index. Right-pane-only `data-testid="grid-row"` (D10) already
 *  disambiguates the two panes under SlickGrid, so this needs no engine branch either. */
export function gridRow(page: Page, row: number): Locator {
  return page.locator(`[data-testid="grid-row"][data-row="${row}"]`);
}

/** The FK/PK nav button for one cell. Under both engines it ends up as a descendant of that cell's
 *  own DOM node once it's showing (tanstack: one per nav-capable cell, CSS-gated; SlickGrid: the
 *  single host-owned button, moved into the cell on hover/selection, D11b) — so the same nested
 *  locator resolves correctly either way. */
export function cellNavButton(page: Page, row: number, column: string): Locator {
  return gridCell(page, row, column).locator('[data-testid="cell-nav-button"]');
}

/** P7 D6: a cell's nav button only appears while its cell carries `.selected` — select it first
 *  the same way a real user's click would, then act on the now-visible button. */
export async function clickCellNav(page: Page, row: number, column: string): Promise<void> {
  await gridCell(page, row, column).click();
  await cellNavButton(page, row, column).click();
}

/** Every pending-insert row — `data-testid="grid-row-insert"` is written once per insert row on
 *  both engines (the right pane only, under SlickGrid), so no engine branch is needed. */
export function insertRow(page: Page): Locator {
  return page.locator('[data-testid="grid-row-insert"]');
}

/** The element that actually scrolls. Under the incumbent this is `.data-grid` itself
 *  (`overflow: auto`); under SlickGrid the host div (`[data-testid="data-grid"]`) never scrolls —
 *  SlickGrid owns its own internal viewport div, `.slick-viewport-top.slick-viewport-right`. */
export const GRID_SCROLLER_SELECTOR =
  ENGINE === 'slick'
    ? '[data-testid="data-grid"] .slick-viewport-top.slick-viewport-right'
    : '[data-testid="data-grid"]';

export function gridScroller(page: Page): Locator {
  return page.locator(GRID_SCROLLER_SELECTOR);
}

/** The sort chevron shown over a sorted column's header. Tanstack draws its own `.sort-indicator`
 *  span; SlickGrid's own `.slick-sort-indicator-asc`/`-desc` (F8, only created once a column is
 *  actually sorted — `setSortColumns` adds the class, it doesn't toggle a rule). */
export function sortIndicators(page: Page): Locator {
  if (ENGINE === 'slick') {
    return page.locator('.slick-sort-indicator-asc, .slick-sort-indicator-desc');
  }
  return page.locator('.sort-indicator');
}

/** A NULL cell's own `.cell-null` marker. Tanstack renders a child `<span class="cell-null">`;
 *  SlickGrid folds the same class onto the cell node itself instead (the formatter's own
 *  `addClasses`, F10 — `-iter2-pacing` D5's "text, never DOM" rule, same reason `.cell-truncated`
 *  is a class + CSS `::after` rather than a child span). `:scope` in a chained locator selector
 *  refers to the parent locator's own matched element(s), so this compound selector resolves
 *  under either shape without an engine branch. */
export function nullMarker(cell: Locator): Locator {
  return cell.locator(':scope.cell-null, :scope .cell-null');
}
