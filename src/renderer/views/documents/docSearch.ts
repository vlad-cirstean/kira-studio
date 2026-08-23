import { reactive } from 'vue';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { documentRow, getPage } from './docPage';

export interface Match {
  row: number;
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

// Per-tab search results — mirrors views/grid/search.ts's searchState, narrowed to one column
// (a document has no columns to disambiguate a match's position within).
export const searchState = reactive({} as Record<string, { matches: Match[]; index: number }>);

export function clearSearchState(tabId: string): void {
  delete searchState[tabId];
}

// D4: closeTab has no way to import this leaf module directly (reality 18) — registers here.
registerTabRuntimeCleanup(clearSearchState);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Mirrors previewLine() in DocumentView.vue exactly (whitespace collapsed, no truncation here —
// truncating the search haystack would just make a match past character 200 unfindable for no
// benefit, since this never re-renders long text anywhere).
function previewLineFor(body: string): string {
  return body.replace(/\s+/g, ' ').trim();
}

// Scoped to the loaded page only, never the server (§8.5's D28, this view's own precedent) —
// and to each document's rendered preview line specifically, not the full raw EJSON body: a
// document's "columns" are dynamic, so there is no per-field grid to search field-by-field the
// way views/grid/search.ts does, and full-text-over-EJSON would be new scope this task doesn't
// ask for. Iterates in chunks of 2 000 rows per animation frame, same budget as the grid's search.
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
  const totalRows = page.rowCount;

  const done = new Promise<Match[]>((resolve) => {
    let row = 0;
    function step(): void {
      if (cancelled) {
        resolve(matches);
        return;
      }
      const chunkEnd = Math.min(totalRows, row + CHUNK_ROWS);
      for (; row < chunkEnd; row++) {
        const doc = documentRow(tabId, row);
        if (!doc) continue;
        const text = previewLineFor(doc.body);
        pattern.lastIndex = 0;
        let m = pattern.exec(text);
        while (m) {
          matches.push({ row, start: m.index, end: m.index + m[0].length });
          if (m[0].length === 0) pattern.lastIndex++; // never loop forever on a zero-width match
          m = pattern.exec(text);
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
