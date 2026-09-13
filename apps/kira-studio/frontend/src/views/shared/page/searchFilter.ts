import { reactive } from 'vue';
import { registerTabRuntimeCleanup } from '../../../state/tabRuntime';

// P31 D16: hoisted out of views/grid/search.ts, whose own P24 D2 toggle four other search
// modules (documents/keyvalue/stream) were about to duplicate verbatim — the exact drift P24's
// F5 already documented in these same four files. One module, one cleanup registration, one
// semantic.
const searchFilterState = reactive({} as Record<string, boolean>);

export function isSearchFiltering(tabId: string): boolean {
  return searchFilterState[tabId] === true;
}

export function setSearchFiltering(tabId: string, on: boolean): void {
  if (on) searchFilterState[tabId] = true;
  else delete searchFilterState[tabId];
}

function clearSearchFilterState(tabId: string): void {
  delete searchFilterState[tabId];
}

registerTabRuntimeCleanup(clearSearchFilterState);

// P24 D2/D3: ascending, de-duplicated page-row indices with at least one match, or `null` when
// the filter is off or there's no completed scan to filter by (D7: an empty query shows every
// row). Every scanner emits matches in ascending row order (the outer loop is always `row`), so
// this is one de-duplicating pass with no sort and no Set.
export function matchedRowsOf(
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
