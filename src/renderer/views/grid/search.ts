import { cellText, isNull } from '@shared/protocol/page';
import { eachMatch, runChunkedScan, type SearchHandle, type SearchQuery } from '../shared/pageScan';
import { createPageSearch } from '../shared/pageSearch';
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
  onProgress: (found: number, rowsScanned: number, totalRows: number) => void,
): SearchHandle<Match> {
  const page = getPage(tabId);
  if (!page || q.text === '') {
    return { cancel() {}, done: Promise.resolve([]) };
  }

  const decoder = new TextDecoder();
  const colCount = page.columns.length;
  const chunks = page.chunks; // a definite alias — narrowing does not persist into scanRow below

  return runChunkedScan<Match>(
    page.rowCount,
    (row, pattern, out) => {
      for (let col = 0; col < colCount; col++) {
        const chunk = chunks[col];
        if (isNull(chunk, row)) continue;
        const text = cellText(chunk, row, decoder);
        eachMatch(pattern, text, (start, end) => out.push({ row, col, start, end }));
      }
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
