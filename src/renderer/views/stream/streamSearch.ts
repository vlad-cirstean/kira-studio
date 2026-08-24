import { reactive } from 'vue';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { isSearchFiltering } from '../shared/searchFilter';
import { getPage, streamRow } from './streamPage';

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

export const streamSearchState = reactive({} as Record<string, StreamSearchState>);

export function clearStreamSearchState(tabId: string): void {
  delete streamSearchState[tabId];
}

// D4: closeTab has no way to import this leaf module directly (reality 18) — registers here,
// mirrors grid/search.ts's own registration.
registerTabRuntimeCleanup(clearStreamSearchState);

export function runStreamSearch(tabId: string, query: string): void {
  if (query === '') {
    clearStreamSearchState(tabId);
    return;
  }
  const page = getPage(tabId);
  const needle = query.toLowerCase();
  const matches: number[] = [];
  if (page) {
    for (let row = 0; row < page.rowCount; row++) {
      const r = streamRow(tabId, row);
      if (!r) continue;
      const haystack = `${r.key ?? ''}\n${r.headers}\n${r.attrs}\n${r.timestamp ?? ''}\n${r.body}`;
      if (haystack.toLowerCase().includes(needle)) matches.push(row);
    }
  }
  streamSearchState[tabId] = { query, matches, index: matches.length > 0 ? 0 : -1 };
}

// P31 D16: streamSearch's own matches are already ascending, distinct row indices (one entry
// per matching row, built by a single `row` loop) — filtering just gates them on the toggle,
// with no de-dup pass needed the way matchedRowsOf's Match[]-shaped callers need one.
export function matchedRows(tabId: string): number[] | null {
  if (!isSearchFiltering(tabId)) return null;
  return streamSearchState[tabId]?.matches ?? null;
}

export function goToNextMatch(tabId: string): number | null {
  const s = streamSearchState[tabId];
  if (!s || s.matches.length === 0) return null;
  s.index = (s.index + 1) % s.matches.length;
  return s.matches[s.index];
}

export function goToPrevMatch(tabId: string): number | null {
  const s = streamSearchState[tabId];
  if (!s || s.matches.length === 0) return null;
  s.index = (s.index - 1 + s.matches.length) % s.matches.length;
  return s.matches[s.index];
}
