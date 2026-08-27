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
    // P42 D39: KeyValueView.vue renders every loaded row directly (no VirtualList), so nothing
    // ever calls setVisibleRows for this tab and this always resolves to `undefined` — the same
    // plain ascending scan as before D37. Still gains D38's progressive publication, which needs
    // no visible-window input at all.
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
