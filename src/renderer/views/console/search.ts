import { cellText, isNull } from '@shared/protocol/page';
import {
  eachMatch,
  emptyScan,
  keyValueRowScanner,
  runChunkedScan,
  type SearchHandle,
  type SearchQuery,
  tabularRowScanner,
} from '../shared/page/scan';
import { createPageSearch } from '../shared/page/search';
import { visibleRowsOf } from '../shared/page/visibleRows';
import { pageVersion } from './resultPages';
import { activePage } from './state';

// P40 D9: the search scope stays the *tab id*, same as grid/documents/keyvalue's own
// PageSearchApi — this file alone resolves "which of the tab's N result sets is active" via
// state.ts's activePage, so views/shared/page/'s two cleanup handlers never have to learn a
// per-result-set key scheme (F9). `col` is a page column index for a tabular result; a document
// row has no per-column projection so it is always 0, and a key/value row is 0 for the field, 1
// for the value — mirroring keyvalue/search.ts's own fixed-column convention.
export interface Match {
  row: number;
  col: number;
  start: number;
  end: number;
}

// Searches the active result set's loaded page only, never the server (§8.5's D28, every other
// view's own precedent).
export function runSearch(
  tabId: string,
  q: SearchQuery,
  onProgress: (
    found: number,
    rowsScanned: number,
    totalRows: number,
    soFar: readonly Match[],
  ) => void,
): SearchHandle<Match> {
  const page = activePage(tabId);
  if (!page || q.text === '') return emptyScan();

  // P42 D39: the rows ConsoleResultGrid.vue's VirtualList currently has on screen (D37) — keyed
  // by tabId like every other search.ts/PageSearchApi entry point here (D9), not by result key,
  // since only the active result set is ever rendered (and therefore reportable) at a time.
  const priority = { priority: visibleRowsOf(tabId) ?? undefined };

  if (page.kind === 'tabular') {
    return runChunkedScan<Match>(
      page.rowCount,
      tabularRowScanner(page, (row, col, start, end) => ({ row, col, start, end })),
      q,
      onProgress,
      priority,
    );
  }

  if (page.kind === 'document') {
    const decoder = new TextDecoder();
    const bodies = page.bodies;
    return runChunkedScan<Match>(
      page.rowCount,
      (row, pattern, out) => {
        if (isNull(bodies, row)) return;
        const text = cellText(bodies, row, decoder);
        eachMatch(pattern, text, (start, end) => out.push({ row, col: 0, start, end }));
      },
      q,
      onProgress,
      priority,
    );
  }

  // A console result is only ever tabular, document or keyvalue (ConsoleResultGrid.vue's own
  // three template branches) — never StreamPage, so this narrows the same way resultPages.ts's
  // keyValueRow() does rather than assuming the else branch away.
  if (page.kind !== 'keyvalue') return emptyScan();
  return runChunkedScan<Match>(
    page.rowCount,
    keyValueRowScanner(page, [0, 1], (row, col, start, end) => ({ row, col, start, end })),
    q,
    onProgress,
    priority,
  );
}

const {
  searchState,
  matchedRows,
  api: pageSearchApi,
} = createPageSearch<Match>({
  runSearch,
  pageVersion,
  loadedRowCount: (tabId) => activePage(tabId)?.rowCount ?? 0,
});

export { matchedRows, pageSearchApi, searchState };
