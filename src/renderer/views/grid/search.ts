import { cellText, isNull } from '@shared/protocol/page';
import { reactive } from 'vue';
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
