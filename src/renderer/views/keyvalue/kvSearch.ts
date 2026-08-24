import { cellText } from '@shared/protocol/page';
import { reactive } from 'vue';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { matchedRowsOf } from '../shared/searchFilter';
import { getPage } from './kvPage';

// Mirrors views/grid/search.ts exactly, narrowed to KeyValuePage's two fixed semantic columns
// (`fields`/`values`, D8.8) instead of a tabular page's caller-defined column set — 'field'/
// 'value' are close enough to 'col' that this stays `col: 'field' | 'value'` rather than an
// index, since there is no columns/chunks array to index into here.
export interface Match {
  row: number;
  col: 'field' | 'value';
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

// Per-tab search results, shared with KeyValueView.vue so it can highlight matches in place.
export const searchState = reactive({} as Record<string, { matches: Match[]; index: number }>);

export function clearSearchState(tabId: string): void {
  delete searchState[tabId];
}

// D4: closeTab has no way to import this leaf module directly (reality 18) — registers here.
registerTabRuntimeCleanup(clearSearchState);

// P31 D16: thin wrapper over matchedRowsOf, same shape as grid/search.ts's own.
export function matchedRows(tabId: string): number[] | null {
  return matchedRowsOf(tabId, searchState[tabId]?.matches);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Searches the loaded page only, never the server — same discipline as grid/search.ts (§8.5's
// D28), applied to keyvalue's own two-column shape. Iterates in chunks of 2 000 rows per
// animation frame; a new keystroke cancels and restarts, and an invalid regex throws
// synchronously here so the caller can show it inline rather than as a rejected scan.
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
  const fields = page.fields;
  const values = page.values;

  const done = new Promise<Match[]>((resolve) => {
    let row = 0;
    function scanCell(col: 'field' | 'value', text: string): void {
      pattern.lastIndex = 0;
      let m = pattern.exec(text);
      while (m) {
        matches.push({ row, col, start: m.index, end: m.index + m[0].length });
        if (m[0].length === 0) pattern.lastIndex++; // never loop forever on a zero-width match
        m = pattern.exec(text);
      }
    }
    function step(): void {
      if (cancelled) {
        resolve(matches);
        return;
      }
      const chunkEnd = Math.min(totalRows, row + CHUNK_ROWS);
      for (; row < chunkEnd; row++) {
        scanCell('field', cellText(fields, row, decoder));
        scanCell('value', cellText(values, row, decoder));
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
