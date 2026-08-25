import { reactive } from 'vue';
import { registerTabRuntimeCleanup } from '../../../state/tabRuntime';
import type { SearchHandle, SearchQuery } from './scan';
import { matchedRowsOf } from './searchFilter';

// P39 D9: what views/shared/page/SearchToolbar.vue is bound to. Each of grid/search.ts,
// documents/search.ts and keyvalue/search.ts exports one literal of this shape, built from
// its own runSearch/clearSearchState/searchState/matchedRows plus its page module's
// getPage/pageVersion — the toolbar itself never imports a specific view's page or search module.
export interface PageSearchApi<M extends { row: number }> {
  runSearch(
    tabId: string,
    q: SearchQuery,
    onProgress: (
      found: number,
      rowsScanned: number,
      totalRows: number,
      soFar: readonly M[],
    ) => void,
  ): SearchHandle<M>;
  clearSearchState(tabId: string): void;
  /** P42 D38: `pending` is set on every partial (mid-scan) publication and absent on the
   *  completed one — the toolbar's own read of "has this scan actually finished" (matchedRows
   *  below returns null while it's set, so filtering never hides a row the scan hasn't reached
   *  yet). */
  searchState: Record<string, { matches: M[]; index: number; pending?: boolean }>;
  matchedRows(tabId: string): number[] | null;
  pageVersion: { n: number };
  loadedRowCount(tabId: string): number;
}

/** The per-tab match record + its tab-close cleanup registration, once per view module. Moved
 *  here from scan.ts (P39 iter3 F4/D3) — this is about per-tab search *state*, not scanning,
 *  and createPageSearch below is its only caller. */
function createSearchState<M extends { row: number }>(): {
  searchState: PageSearchApi<M>['searchState'];
  clearSearchState(tabId: string): void;
  matchedRows(tabId: string): number[] | null;
} {
  const searchState = reactive({} as PageSearchApi<M>['searchState']);

  function clearSearchState(tabId: string): void {
    delete searchState[tabId];
  }
  registerTabRuntimeCleanup(clearSearchState);

  // P42 D38: a partial (mid-scan) publication filters nothing — the matches found *so far* say
  // nothing about the rows the scan hasn't reached yet, and hiding on that basis would make rows
  // vanish and reappear as the scan caught up, under a user trying to read them.
  function matchedRows(tabId: string): number[] | null {
    const entry = searchState[tabId];
    if (entry?.pending) return null;
    return matchedRowsOf(tabId, entry?.matches);
  }

  return { searchState, clearSearchState, matchedRows };
}

// P39 iter2 F2/D3: grid/search.ts, documents/search.ts and keyvalue/search.ts each assembled this
// same six-ingredient PageSearchApi literal by hand from createSearchState()'s three return values
// plus their own runSearch/pageVersion/getPage. One factory in one place instead of the same
// assembly written out three times.
export function createPageSearch<M extends { row: number }>(opts: {
  runSearch: PageSearchApi<M>['runSearch'];
  pageVersion: { n: number };
  loadedRowCount(tabId: string): number;
}): {
  searchState: PageSearchApi<M>['searchState'];
  clearSearchState(tabId: string): void;
  matchedRows(tabId: string): number[] | null;
  api: PageSearchApi<M>;
} {
  const { searchState, clearSearchState, matchedRows } = createSearchState<M>();
  return {
    searchState,
    clearSearchState,
    matchedRows,
    api: {
      runSearch: opts.runSearch,
      clearSearchState,
      searchState,
      matchedRows,
      pageVersion: opts.pageVersion,
      loadedRowCount: opts.loadedRowCount,
    },
  };
}
