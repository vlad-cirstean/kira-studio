import {
  emptyScan,
  keyValueRowScanner,
  runChunkedScan,
  type SearchHandle,
  type SearchQuery,
} from '../shared/page/scan';
import { createPageSearch } from '../shared/page/search';
import { visibleRowsOf } from '../shared/page/visibleRows';
import { getPage, pageVersion } from './page';

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

// Searches the loaded page only, never the server — same discipline as grid/search.ts (§8.5's
// D28), applied to keyvalue's own two-column shape.
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
    keyValueRowScanner(page, ['field', 'value'], (row, col, start, end) => ({
      row,
      col,
      start,
      end,
    })),
    q,
    onProgress,
    // P42 D39/P49 D5: KeyValueView.vue now reports its own visible window (VirtualList's
    // visible-range emit), so this scans on-screen rows first instead of always starting cold at
    // row 0 — closing the gap this comment used to record.
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
