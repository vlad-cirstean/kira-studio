import { cellText, isNull } from '@shared/protocol/page';
import { reactive } from 'vue';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import {
  isSearchFiltering,
  matchedRowsOf,
  searchFilterState,
  setSearchFiltering,
} from '../shared/searchFilter';
import { getPage } from './page';

// P31 D16: the filter-toggle state (and matchedRows' own de-dup pass) moved to
// views/shared/searchFilter.ts so documents/keyvalue/stream can share it — re-exported here so
// this module's own public shape, and every existing importer, is unchanged.
export { isSearchFiltering, searchFilterState, setSearchFiltering };

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

// P24 D2/D3, now a thin wrapper over matchedRowsOf (D16) — reads only `entry.matches`, so
// prev/next (which only move `entry.index`) never invalidate it.
export function matchedRows(tabId: string): number[] | null {
  return matchedRowsOf(tabId, searchState[tabId]?.matches);
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
