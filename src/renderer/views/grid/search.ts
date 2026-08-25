import { cellText, isNull } from '@shared/protocol/page';
import { runChunkedScan, type SearchHandle, type SearchQuery } from '../shared/pageScan';
import { createPageSearch } from '../shared/pageSearch';
import { isSearchFiltering, searchFilterState, setSearchFiltering } from '../shared/searchFilter';
import { getPage, pageVersion } from './page';

export type { SearchHandle, SearchQuery };
// P31 D16: the filter-toggle state (and matchedRows' own de-dup pass) moved to
// views/shared/searchFilter.ts so documents/keyvalue/stream can share it — re-exported here so
// this module's own public shape, and every existing importer, is unchanged.
export { isSearchFiltering, searchFilterState, setSearchFiltering };

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
        pattern.lastIndex = 0;
        let m = pattern.exec(text);
        while (m) {
          out.push({ row, col, start: m.index, end: m.index + m[0].length });
          if (m[0].length === 0) pattern.lastIndex++; // never loop forever on a zero-width match
          m = pattern.exec(text);
        }
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
