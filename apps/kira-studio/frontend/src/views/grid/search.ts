import {
  emptyScan,
  runChunkedScan,
  type SearchHandle,
  type SearchQuery,
  tabularRowScanner,
} from '../shared/page/scan';
import { createPageSearch } from '../shared/page/search';
import { visibleRowsOf } from '../shared/page/visibleRows';
import { getPage, pageVersion } from './page';

export interface Match {
  row: number;
  col: number; // index into the page's own columns/chunks, not the display order
  start: number;
  end: number;
}

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
  const page = getPage(tabId);
  if (!page || q.text === '') return emptyScan();

  return runChunkedScan<Match>(
    page.rowCount,
    tabularRowScanner(page, (row, col, start, end) => ({ row, col, start, end })),
    q,
    onProgress,
    // P42 D39: the rows DataGrid.vue currently has on screen, scanned first (D37) — the ones the
    // find highlight actually needs to reach before anything else.
    { priority: visibleRowsOf(tabId) ?? undefined },
  );
}

const {
  searchState,
  matchedRows,
  api: pageSearchApi,
} = createPageSearch<Match>({
  runSearch,
  pageVersion,
  loadedRowCount: (tabId) => getPage(tabId)?.rowCount ?? 0,
});

export { matchedRows, pageSearchApi, searchState };
