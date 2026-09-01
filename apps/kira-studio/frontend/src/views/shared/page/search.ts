import { type ComputedRef, computed, shallowReactive } from 'vue';
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
   *  yet). P5 C4/F6: `found` is the scan's true, uncapped match count — present whenever `matches`
   *  is (mid-scan and completed alike), `undefined` only for a tab with no search state at all. */
  searchState: Record<string, { matches: M[]; index: number; pending?: boolean; found?: number }>;
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
  // P2 R1: every writer (SearchToolbar.vue's startSearch/goNext/goPrev) replaces a tab's whole
  // entry atomically — a scan publishes a brand-new `matches` array wholesale, never pushes into an
  // existing one — so nothing below the top level needs field-by-field reactivity. `reactive()`
  // used to deep-wrap every match object in every tab's array (thousands, for a large scan) in a
  // Proxy for no benefit; shallowReactive tracks exactly what's actually mutated: `searchState[id]`
  // being set to a new value.
  const searchState = shallowReactive({} as PageSearchApi<M>['searchState']);

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

// P48 F8: DataGrid.vue, KeyValueView.vue and ConsoleResultGrid.vue each built this same
// plus current-match computed, rebuilt only when the search result changes (a completed scan or
// prev/next), not per cell — differing only in `col`'s type ('field' | 'value' for a key/value row,
// a page column index everywhere else). `tabId` is a function, not a plain string, so the computed
// re-tracks when a caller's own prop changes.
//
// P2 R1: this used to build a Set<string> of `${row}:${col}` template-literal keys — a string
// allocation and concatenation per match, on every rebuild, purely to give `has` an O(1) lookup a
// nested Map/Set gets for free with no string keys at all (row is already a native number; col is
// whatever primitive type C already is). Mirrors DocumentView.vue's own docMatchIndex, which never
// had this problem since it never used createMatchIndex.
export function createMatchIndex<C>(
  state: Record<string, { matches: { row: number; col: C }[]; index: number }>,
  tabId: () => string,
): ComputedRef<{
  has(row: number, col: C): boolean;
  isCurrent(row: number, col: C): boolean;
} | null> {
  return computed(() => {
    const entry = state[tabId()];
    if (!entry) return null;
    const byRow = new Map<number, Set<C>>();
    for (const m of entry.matches) {
      let cols = byRow.get(m.row);
      if (!cols) {
        cols = new Set<C>();
        byRow.set(m.row, cols);
      }
      cols.add(m.col);
    }
    const current = entry.index >= 0 ? entry.matches[entry.index] : undefined;
    return {
      has: (row: number, col: C) => byRow.get(row)?.has(col) ?? false,
      isCurrent: (row: number, col: C) => !!current && current.row === row && current.col === col,
    };
  });
}
