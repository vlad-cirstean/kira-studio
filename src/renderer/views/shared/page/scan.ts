// P39 F10: grid/search.ts, documents/search.ts and keyvalue/search.ts declared the same
// SearchQuery/SearchHandle/CHUNK_ROWS/escapeRegExp and the same rAF-chunked driver with the same
// cancel/zero-width-match/onProgress/resolve semantics, differing only in the per-row scan body.
// stream/search.ts is deliberately NOT built on this — it is a simpler, different scanner
// (one case-insensitive substring match across five fixed columns, no case/word/regex toggles).

export interface SearchQuery {
  text: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface SearchHandle<M> {
  cancel(): void;
  done: Promise<M[]>;
}

const CHUNK_ROWS = 2000;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Throws SyntaxError synchronously for an invalid regex, before any scan starts. Only called from
 *  runChunkedScan below; the SyntaxError still surfaces to a toolbar through runSearch → this. */
function compilePattern(q: SearchQuery): RegExp {
  const flags = q.matchCase ? 'g' : 'gi';
  return q.regex
    ? new RegExp(q.text, flags)
    : new RegExp(q.wholeWord ? `\\b${escapeRegExp(q.text)}\\b` : escapeRegExp(q.text), flags);
}

/** Walks every match of `pattern` in `text`, calling `emit(start, end)` for each — the zero-width
 *  match guard (a pattern like `x*` or `(?:)` that can match an empty string) that
 *  grid/documents/keyvalue's per-row scan bodies each wrote out identically. `pattern.lastIndex`
 *  is reset first so a shared RegExp scans from the start. */
export function eachMatch(
  pattern: RegExp,
  text: string,
  emit: (start: number, end: number) => void,
): void {
  pattern.lastIndex = 0;
  let m = pattern.exec(text);
  while (m) {
    emit(m.index, m.index + m[0].length);
    if (m[0].length === 0) pattern.lastIndex++; // never loop forever on a zero-width match
    m = pattern.exec(text);
  }
}

// §8.5 (D28): searches the loaded page only, never the server. Iterates in chunks of 2 000 rows
// per animation frame; a new keystroke cancels and restarts.
export function runChunkedScan<M>(
  totalRows: number,
  scanRow: (row: number, pattern: RegExp, out: M[]) => void,
  q: SearchQuery,
  onProgress: (found: number, rowsScanned: number, totalRows: number) => void,
): SearchHandle<M> {
  const pattern = compilePattern(q);
  let cancelled = false;
  const matches: M[] = [];

  const done = new Promise<M[]>((resolve) => {
    let row = 0;
    function step(): void {
      if (cancelled) {
        resolve(matches);
        return;
      }
      const chunkEnd = Math.min(totalRows, row + CHUNK_ROWS);
      for (; row < chunkEnd; row++) {
        scanRow(row, pattern, matches);
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
