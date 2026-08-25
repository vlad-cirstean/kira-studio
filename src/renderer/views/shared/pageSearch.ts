import type { SearchHandle, SearchQuery } from './pageScan';

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
