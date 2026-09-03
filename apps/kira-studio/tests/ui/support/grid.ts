import type { Locator, Page } from '@playwright/test';

// P22 Pass B — the grid locator helpers every grid-touching spec used to redefine locally,
// resolved once for the SlickGrid DOM shape (the only grid engine this app has — the user's own
// call, "no turning back": no incumbent survives to A/B against, so no engine branch here either).
//
// SlickGrid's own `appendRowHtml` clones the row div per frozen pane (F4) — with `frozenColumn: 0`
// a row's `.slick-row` exists TWICE (the gutter's left-pane clone and the data cells' right-pane
// clone), both carrying the same `data-row`, while `.slick-cell` exists once. `data-testid=
// "grid-row"` is written onto the right pane only (`SlickGridHost.vue`'s own `onRendered` pass,
// D10), so a plain `[data-testid="grid-row"][data-row="N"]` already resolves to exactly one
// element — only the cell/gutter selectors, which must additionally scope into the correct pane,
// need the pane prefix below.

const RIGHT_PANE = '.grid-canvas-top.grid-canvas-right';

/** A data cell, addressed the way every other subsystem addresses one: a page row plus a display
 *  column name. */
export function gridCell(page: Page, row: number, column: string): Locator {
  return page.locator(
    `[data-testid="data-grid"] ${RIGHT_PANE} [data-testid="grid-row"][data-row="${row}"] [data-testid="grid-cell"][data-column="${column}"]`,
  );
}

export async function cellText(page: Page, row: number, column: string): Promise<string> {
  return (await gridCell(page, row, column)).innerText();
}

/** The gutter (row-number) cell for one page row. The gutter lives in the frozen left pane, which
 *  carries no `data-testid="grid-row"` of its own (F4/D10) — `data-row` is still written on both
 *  panes, and only the left pane has a `[data-testid="grid-gutter-cell"]` descendant, so the
 *  combination is unambiguous without a right/left-pane prefix. */
export function gutterCell(page: Page, row: number): Locator {
  return page.locator(
    `[data-testid="data-grid"] .slick-row[data-row="${row}"] [data-testid="grid-gutter-cell"]`,
  );
}

/** A data column's header cell. */
export function headerCell(page: Page, column: string): Locator {
  return page.locator(`[data-testid="grid-header-cell"][data-column="${column}"]`);
}

/** A whole rendered row, by page row index. Right-pane-only `data-testid="grid-row"` (D10) already
 *  disambiguates the two panes. */
export function gridRow(page: Page, row: number): Locator {
  return page.locator(`[data-testid="grid-row"][data-row="${row}"]`);
}

/** The FK/PK nav button for one cell — the single host-owned button (D11b), moved into the cell
 *  on hover/selection, so a nested locator resolves it correctly once it's showing there. */
export function cellNavButton(page: Page, row: number, column: string): Locator {
  return gridCell(page, row, column).locator('[data-testid="cell-nav-button"]');
}

/** P7 D6: a cell's nav button only appears while its cell carries `.selected` — select it first
 *  the same way a real user's click would, then act on the now-visible button. */
export async function clickCellNav(page: Page, row: number, column: string): Promise<void> {
  await gridCell(page, row, column).click();
  await cellNavButton(page, row, column).click();
}

/** Every pending-insert row — `data-testid="grid-row-insert"` is written once per insert row, the
 *  right pane only. */
export function insertRow(page: Page): Locator {
  return page.locator('[data-testid="grid-row-insert"]');
}

/** The element that actually scrolls. The host div (`[data-testid="data-grid"]`) never scrolls —
 *  SlickGrid owns its own internal viewport div, `.slick-viewport-top.slick-viewport-right`. */
export const GRID_SCROLLER_SELECTOR =
  '[data-testid="data-grid"] .slick-viewport-top.slick-viewport-right';

export function gridScroller(page: Page): Locator {
  return page.locator(GRID_SCROLLER_SELECTOR);
}

/** The sort chevron shown over a sorted column's header — `.slick-sort-indicator-asc`/`-desc`
 *  (F8, only created once a column is actually sorted; `setSortColumns` adds the class, it
 *  doesn't toggle a rule). */
export function sortIndicators(page: Page): Locator {
  return page.locator('.slick-sort-indicator-asc, .slick-sort-indicator-desc');
}

/** A NULL cell's own `.cell-null` marker. SlickGrid folds the class onto the cell node itself (the
 *  formatter's own `addClasses`, F10 — `-iter2-pacing` D5's "text, never DOM" rule, same reason
 *  `.cell-truncated` is a class + CSS `::after` rather than a child span). `:scope` in a chained
 *  locator selector refers to the parent locator's own matched element(s). */
export function nullMarker(cell: Locator): Locator {
  return cell.locator(':scope.cell-null, :scope .cell-null');
}
