import { registerTabRuntimeCleanup } from '@workbench/state/tabRuntime';
import { defineStore } from 'pinia';
import { reactive } from 'vue';

// P31 D16: hoisted out of views/grid/search.ts, whose own P24 D2 toggle four other search
// modules (documents/keyvalue/stream) were about to duplicate verbatim — the exact drift P24's
// F5 already documented in these same four files. One module, one cleanup registration, one
// semantic.
export const usePageSearchFilterStore = defineStore('pageSearchFilter', () => {
  const state = reactive<Record<string, boolean>>({});

  function isSearchFiltering(tabId: string): boolean {
    return state[tabId] === true;
  }

  function setSearchFiltering(tabId: string, on: boolean): void {
    if (on) state[tabId] = true;
    else delete state[tabId];
  }

  function clearSearchFilterState(tabId: string): void {
    delete state[tabId];
    // P63: widens the same way search.ts's own clearSearchState does — see its comment.
    delete state[`${tabId}::preview`];
  }

  registerTabRuntimeCleanup(clearSearchFilterState);

  // P24 D2/D3: ascending, de-duplicated page-row indices with at least one match, or `null` when
  // the filter is off or there's no completed scan to filter by (D7: an empty query shows every
  // row). Every scanner emits matches in ascending row order (the outer loop is always `row`), so
  // this is one de-duplicating pass with no sort and no Set.
  function matchedRowsOf(
    tabId: string,
    matches: ReadonlyArray<{ row: number }> | undefined,
  ): number[] | null {
    if (!isSearchFiltering(tabId) || !matches) return null;
    const rows: number[] = [];
    let last = -1;
    for (const m of matches) {
      if (m.row !== last) {
        rows.push(m.row);
        last = m.row;
      }
    }
    return rows;
  }

  return { isSearchFiltering, setSearchFiltering, matchedRowsOf };
});
