import {
  createSearchState,
  runChunkedScan,
  type SearchHandle,
  type SearchQuery,
} from '../shared/pageScan';
import { documentRow, getPage } from './docPage';

export type { SearchHandle, SearchQuery };

export interface Match {
  row: number;
  start: number;
  end: number;
}

// Mirrors views/grid/search.ts's searchState, narrowed to one column (a document has no columns
// to disambiguate a match's position within).
const { searchState, clearSearchState, matchedRows } = createSearchState<Match>();

export { clearSearchState, matchedRows, searchState };

// P27 D9/P31 D20: DocumentView.vue's collapsed row shows only the `_id` until expanded (D1) —
// exported so the view can build the *same* string a search matched against, and wrap the
// matched substring using docSearch's own start/end offsets without the two ever disagreeing.
// This searches the whole document body regardless, whitespace collapsed and never truncated, so
// a match can exist even though the un-searched row shows none of that text.
export function previewLineFor(body: string): string {
  return body.replace(/\s+/g, ' ').trim();
}

// Scoped to the loaded page only, never the server (§8.5's D28, this view's own precedent) —
// and to each document's rendered preview line specifically, not the full raw EJSON body: a
// document's "columns" are dynamic, so there is no per-field grid to search field-by-field the
// way views/grid/search.ts does, and full-text-over-EJSON would be new scope this task doesn't
// ask for.
export function runSearch(
  tabId: string,
  q: SearchQuery,
  onProgress: (found: number, rowsScanned: number, totalRows: number) => void,
): SearchHandle<Match> {
  const page = getPage(tabId);
  if (!page || q.text === '') {
    return { cancel() {}, done: Promise.resolve([]) };
  }

  return runChunkedScan<Match>(
    page.rowCount,
    (row, pattern, out) => {
      const doc = documentRow(tabId, row);
      if (!doc) return;
      const text = previewLineFor(doc.body);
      pattern.lastIndex = 0;
      let m = pattern.exec(text);
      while (m) {
        out.push({ row, start: m.index, end: m.index + m[0].length });
        if (m[0].length === 0) pattern.lastIndex++; // never loop forever on a zero-width match
        m = pattern.exec(text);
      }
    },
    q,
    onProgress,
  );
}
