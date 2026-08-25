import { createSearchState, type SearchHandle, type SearchQuery } from './pageScan';

// P39 D9: what views/shared/PageSearchToolbar.vue is bound to. Each of grid/search.ts,
// documents/search.ts and keyvalue/search.ts exports one literal of this shape, built from
// its own runSearch/clearSearchState/searchState/matchedRows plus its page module's
// getPage/pageVersion — the toolbar itself never imports a specific view's page or search module.
export interface PageSearchApi<M extends { row: number }> {
  runSearch(
    tabId: string,
    q: SearchQuery,
    onProgress: (found: number, rowsScanned: number, totalRows: number) => void,
  ): SearchHandle<M>;
  clearSearchState(tabId: string): void;
  searchState: Record<string, { matches: M[]; index: number }>;
  matchedRows(tabId: string): number[] | null;
  pageVersion: { n: number };
  loadedRowCount(tabId: string): number;
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
  searchState: Record<string, { matches: M[]; index: number }>;
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
