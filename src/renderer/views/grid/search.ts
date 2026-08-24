import { cellText, isNull } from '@shared/protocol/page';
import { reactive } from 'vue';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { getPage } from './page';

export interface Match {
  row: number;
  col: number; // index into the page's own columns/chunks, not the display order
  start: number;
  end: number;
}

export interface SearchQuery {
  text: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface SearchHandle {
  cancel(): void;
  done: Promise<Match[]>;
}

const CHUNK_ROWS = 2000;

// Per-tab search results, shared with DataGrid.vue so it can highlight matches in place.
export const searchState = reactive({} as Record<string, { matches: Match[]; index: number }>);

export function clearSearchState(tabId: string): void {
  delete searchState[tabId];
}

// D4: closeTab has no way to import this leaf module directly (reality 18) — registers here.
registerTabRuntimeCleanup(clearSearchState);

// P24 D2: the find widget's "hide non-matching rows" toggle. Kept separate from `searchState`
// because that record is deleted every time the query goes empty (clearSearchState), which would
// otherwise silently turn the toggle off on every cleared keystroke.
export const searchFilterState = reactive({} as Record<string, boolean>);

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
// row). `runSearch` already emits matches in ascending row order (outer loop is `row`), so this
// is one de-duplicating pass with no sort and no Set — and it reads only `entry.matches`, so
// prev/next (which only move `entry.index`) never invalidate it.
export function matchedRows(tabId: string): number[] | null {
  if (!isSearchFiltering(tabId)) return null;
  const entry = searchState[tabId];
  if (!entry) return null;
  const rows: number[] = [];
  let last = -1;
  for (const m of entry.matches) {
    if (m.row !== last) {
      rows.push(m.row);
      last = m.row;
    }
  }
  return rows;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// §8.5 (D28): searches the loaded page only, never the server. Iterates in chunks of 2 000
// rows per animation frame, decoding transiently and retaining only match coordinates — keeping
// decoded strings for a whole page would undo D3. A new keystroke cancels and restarts; an
// invalid regex throws synchronously here, before any scan starts, so the caller can catch it
// and show it inline rather than it surfacing as a rejected scan.
export function runSearch(
  tabId: string,
  q: SearchQuery,
  onProgress: (found: number, rowsScanned: number, totalRows: number) => void,
): SearchHandle {
  const page = getPage(tabId);
  if (!page || q.text === '') {
    return { cancel() {}, done: Promise.resolve([]) };
  }

  const flags = q.matchCase ? 'g' : 'gi';
  const pattern = q.regex
    ? new RegExp(q.text, flags) // throws SyntaxError synchronously for invalid input
    : new RegExp(q.wholeWord ? `\\b${escapeRegExp(q.text)}\\b` : escapeRegExp(q.text), flags);

  let cancelled = false;
  const matches: Match[] = [];
  const decoder = new TextDecoder();
  const totalRows = page.rowCount;
  const colCount = page.columns.length;
  const chunks = page.chunks; // a definite alias — narrowing does not persist into step() below

  const done = new Promise<Match[]>((resolve) => {
    let row = 0;
    function step(): void {
      if (cancelled) {
        resolve(matches);
        return;
      }
      const chunkEnd = Math.min(totalRows, row + CHUNK_ROWS);
      for (; row < chunkEnd; row++) {
        for (let col = 0; col < colCount; col++) {
          const chunk = chunks[col];
          if (isNull(chunk, row)) continue;
          const text = cellText(chunk, row, decoder);
          pattern.lastIndex = 0;
          let m = pattern.exec(text);
          while (m) {
            matches.push({ row, col, start: m.index, end: m.index + m[0].length });
            if (m[0].length === 0) pattern.lastIndex++; // never loop forever on a zero-width match
            m = pattern.exec(text);
          }
        }
      }
      onProgress(matches.length, row, totalRows);
      if (row < totalRows) requestAnimationFrame(step);
      else resolve(matches);
    }
    requestAnimationFrame(step);
  });

  return {
    cancel() {
      cancelled = true;
    },
    done,
  };
}
