import { cellText } from '@shared/protocol/page';
import { eachMatch, runChunkedScan, type SearchHandle, type SearchQuery } from '../shared/pageScan';
import { createPageSearch } from '../shared/pageSearch';
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
  onProgress: (found: number, rowsScanned: number, totalRows: number) => void,
): SearchHandle<Match> {
  const page = getPage(tabId);
  if (!page || q.text === '') {
    return { cancel() {}, done: Promise.resolve([]) };
  }

  const decoder = new TextDecoder();
  const fields = page.fields;
  const values = page.values;

  return runChunkedScan<Match>(
    page.rowCount,
    (row, pattern, out) => {
      function scanCell(col: 'field' | 'value', text: string): void {
        eachMatch(pattern, text, (start, end) => out.push({ row, col, start, end }));
      }
      scanCell('field', cellText(fields, row, decoder));
      scanCell('value', cellText(values, row, decoder));
    },
    q,
    onProgress,
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
