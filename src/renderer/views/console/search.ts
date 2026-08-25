import { cellText, isNull, type TextColumnChunk } from '@shared/protocol/page';
import {
  eachMatch,
  runChunkedScan,
  type SearchHandle,
  type SearchQuery,
} from '../shared/page/scan';
import { createPageSearch } from '../shared/page/search';
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

function scanChunk(
  row: number,
  col: number,
  chunk: TextColumnChunk,
  decoder: TextDecoder,
  pattern: RegExp,
  out: Match[],
): void {
  if (isNull(chunk, row)) return;
  const text = cellText(chunk, row, decoder);
  eachMatch(pattern, text, (start, end) => out.push({ row, col, start, end }));
}

// Searches the active result set's loaded page only, never the server (§8.5's D28, every other
// view's own precedent).
export function runSearch(
  tabId: string,
  q: SearchQuery,
  onProgress: (found: number, rowsScanned: number, totalRows: number) => void,
): SearchHandle<Match> {
  const page = activePage(tabId);
  if (!page || q.text === '') {
    return { cancel() {}, done: Promise.resolve([]) };
  }

  const decoder = new TextDecoder();

  if (page.kind === 'tabular') {
    const colCount = page.columns.length;
    const chunks = page.chunks;
    return runChunkedScan<Match>(
      page.rowCount,
      (row, pattern, out) => {
        for (let col = 0; col < colCount; col++) {
          const chunk = chunks[col];
          if (chunk) scanChunk(row, col, chunk, decoder, pattern, out);
        }
      },
      q,
      onProgress,
    );
  }

  if (page.kind === 'document') {
    const bodies = page.bodies;
    return runChunkedScan<Match>(
      page.rowCount,
      (row, pattern, out) => scanChunk(row, 0, bodies, decoder, pattern, out),
      q,
      onProgress,
    );
  }

  // A console result is only ever tabular, document or keyvalue (ConsoleResultGrid.vue's own
  // three template branches) — never StreamPage, so this narrows the same way resultPages.ts's
  // keyValueRow() does rather than assuming the else branch away.
  if (page.kind !== 'keyvalue') return { cancel() {}, done: Promise.resolve([]) };
  const fields = page.fields;
  const values = page.values;
  return runChunkedScan<Match>(
    page.rowCount,
    (row, pattern, out) => {
      scanChunk(row, 0, fields, decoder, pattern, out);
      scanChunk(row, 1, values, decoder, pattern, out);
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
  loadedRowCount: (tabId) => activePage(tabId)?.rowCount ?? 0,
});

export { matchedRows, pageSearchApi, searchState };
