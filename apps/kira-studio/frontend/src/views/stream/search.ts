import { cellText, isNull, type StreamPage } from '@shared/protocol/page';
import { reactive } from 'vue';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { isSearchFiltering } from '../shared/page/searchFilter';
import { getPage } from './page';

// Item 5's precedent (grid/search.ts): filters purely client-side against the already-fetched
// page, never a fresh server call — `getPage`'s rowCount is the only thing this ever iterates.
// Kept deliberately simpler than grid/search.ts's own module: one case-insensitive substring
// match across all five columns (no whole-word/regex toggles, no requestAnimationFrame chunking)
// — a stream page's five fixed short-text columns are a much smaller, much more uniform search
// surface than a SQL grid's arbitrary N-column, arbitrary-width page, so the extra machinery grid/
// search.ts needs to stay off the frame budget for a big page isn't earning its keep here. Applies
// identically to Kafka and SQS pages (search is read-only, no protocol difference — item 5).
export interface StreamSearchState {
  query: string;
  matches: number[]; // row indices, ascending
  index: number; // position within `matches`, or -1 when there are none
}

export const searchState = reactive({} as Record<string, StreamSearchState>);

export function clearSearchState(tabId: string): void {
  delete searchState[tabId];
}

// D4: closeTab has no way to import this leaf module directly (reality 18) — registers here,
// mirrors grid/search.ts's own registration.
registerTabRuntimeCleanup(clearSearchState);

// P21 round 2 performance finding 1: rowMatches used to be `streamRow(tabId, row)` — every field
// read that way, page.ts's own comment explains, goes through store.cachedView/store.cached (the
// same memoizing decode/view cache the grid/documents/console hosts use), so the very first
// search keystroke on a page permanently decoded and cached *every* row, undoing the visible-
// window pruning that otherwise only re-runs on a scroll event (setVisibleWindow). This reads
// straight off the page's own chunks with a plain TextDecoder instead, the same way scan.ts's own
// tabularRowScanner/keyValueRowScanner do for every other paged view's search — nothing here is
// retained past this one call.
//
// Each column is checked (and case-folded) independently rather than concatenated into one
// haystack string first: a hit in an early, typically-short column (key/headers) skips decoding
// and lowering the row's own body at all, and a miss allocates only that one column's own
// lowercase copy rather than the whole row's five fields joined together.
function rowMatches(page: StreamPage, row: number, needle: string, decoder: TextDecoder): boolean {
  if (!isNull(page.keys, row) && cellText(page.keys, row, decoder).toLowerCase().includes(needle)) {
    return true;
  }
  if (cellText(page.headers, row, decoder).toLowerCase().includes(needle)) return true;
  if (cellText(page.attrs, row, decoder).toLowerCase().includes(needle)) return true;
  if (
    !isNull(page.timestamps, row) &&
    cellText(page.timestamps, row, decoder).toLowerCase().includes(needle)
  ) {
    return true;
  }
  return cellText(page.bodies, row, decoder).toLowerCase().includes(needle);
}

export function runSearch(tabId: string, query: string): void {
  if (query === '') {
    clearSearchState(tabId);
    return;
  }
  const page = getPage(tabId);
  const needle = query.toLowerCase();
  const matches: number[] = [];
  if (page) {
    const decoder = new TextDecoder();
    for (let row = 0; row < page.rowCount; row++) {
      if (rowMatches(page, row, needle, decoder)) matches.push(row);
    }
  }
  searchState[tabId] = { query, matches, index: matches.length > 0 ? 0 : -1 };
}

// P31 D16: this module's own matches are already ascending, distinct row indices (one entry
// per matching row, built by a single `row` loop) — filtering just gates them on the toggle,
// with no de-dup pass needed the way matchedRowsOf's Match[]-shaped callers need one.
export function matchedRows(tabId: string): number[] | null {
  if (!isSearchFiltering(tabId)) return null;
  return searchState[tabId]?.matches ?? null;
}

export function goToNextMatch(tabId: string): number | null {
  const s = searchState[tabId];
  if (!s || s.matches.length === 0) return null;
  s.index = (s.index + 1) % s.matches.length;
  return s.matches[s.index];
}

export function goToPrevMatch(tabId: string): number | null {
  const s = searchState[tabId];
  if (!s || s.matches.length === 0) return null;
  s.index = (s.index - 1 + s.matches.length) % s.matches.length;
  return s.matches[s.index];
}
