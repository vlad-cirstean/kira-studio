import { cellText, isNull, type TabularPage, type TextColumnChunk } from '@shared/protocol/page';

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
//
// P42 D37: `opts.priority`, when given, is scanned first — in its own frame, reported through
// `onProgress` — before the ordinary ascending pass starts from row 0. That ascending pass always
// rebuilds `matches` from scratch and is what `done` resolves to, so the final array is strictly
// ascending regardless of where the priority window sat (F30's contract); the window's own rows
// are therefore scanned twice, which is free next to a page of thousands. `onProgress`'s 4th
// argument is the matches found so far — for the priority tick, that window's own matches only
// (never folded into `matches` itself); for every tick after, `matches` itself, as a fresh
// ascending slice. Omitting `opts` is byte-for-byte today's behaviour.
export function runChunkedScan<M>(
  totalRows: number,
  scanRow: (row: number, pattern: RegExp, out: M[]) => void,
  q: SearchQuery,
  onProgress: (found: number, rowsScanned: number, totalRows: number, soFar: readonly M[]) => void,
  opts?: { priority?: { from: number; to: number } },
): SearchHandle<M> {
  const pattern = compilePattern(q);
  let cancelled = false;
  const matches: M[] = [];

  const done = new Promise<M[]>((resolve) => {
    function runMainPass(): void {
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
        onProgress(matches.length, row, totalRows, matches);
        if (row < totalRows) requestAnimationFrame(step);
        else resolve(matches);
      }
      requestAnimationFrame(step);
    }

    const priority = opts?.priority;
    const from = priority ? Math.max(0, priority.from) : 0;
    const to = priority ? Math.min(totalRows, priority.to) : 0;
    if (to > from) {
      requestAnimationFrame(() => {
        if (cancelled) {
          resolve(matches);
          return;
        }
        const priorityMatches: M[] = [];
        for (let row = from; row < to; row++) scanRow(row, pattern, priorityMatches);
        onProgress(priorityMatches.length, 0, totalRows, priorityMatches);
        runMainPass();
      });
    } else {
      runMainPass();
    }
  });

  return {
    cancel() {
      cancelled = true;
    },
    done,
  };
}

// P48 F9: grid/documents/keyvalue/console's search.ts each repeated this same four-line early-out
// for "no page yet, or an empty query" — a scan that never starts.
export function emptyScan<M>(): SearchHandle<M> {
  return { cancel() {}, done: Promise.resolve([]) };
}

/** P48 F9: the tabular per-row scan body grid/search.ts and console/search.ts's tabular branch
 *  each wrote out — every column, skipping a null cell. `make` builds the caller's own Match
 *  shape from the (row, col, start, end) the scan found. */
export function tabularRowScanner<M>(
  page: Pick<TabularPage, 'columns' | 'chunks'>,
  make: (row: number, col: number, start: number, end: number) => M,
): (row: number, pattern: RegExp, out: M[]) => void {
  const decoder = new TextDecoder();
  const colCount = page.columns.length;
  const chunks = page.chunks; // a definite alias — narrowing does not persist into the closure
  return (row, pattern, out) => {
    for (let col = 0; col < colCount; col++) {
      const chunk = chunks[col];
      if (isNull(chunk, row)) continue;
      const text = cellText(chunk, row, decoder);
      eachMatch(pattern, text, (start, end) => out.push(make(row, col, start, end)));
    }
  };
}

/** P48 F9: the two-chunk field/value scan keyvalue/search.ts and console/search.ts's keyvalue
 *  branch each wrote out, differing only in whether `col` is spelled `'field'|'value'` or `0|1`
 *  — `cols` supplies whichever pair the caller's own Match shape uses. Neither chunk is ever
 *  null by construction (KeyValuePageBuilder.push takes plain strings), so — unlike
 *  tabularRowScanner — there is no isNull check to share. */
export function keyValueRowScanner<M, C>(
  page: { fields: TextColumnChunk; values: TextColumnChunk },
  cols: [C, C],
  make: (row: number, col: C, start: number, end: number) => M,
): (row: number, pattern: RegExp, out: M[]) => void {
  const decoder = new TextDecoder();
  return (row, pattern, out) => {
    const fieldText = cellText(page.fields, row, decoder);
    eachMatch(pattern, fieldText, (start, end) => out.push(make(row, cols[0], start, end)));
    const valueText = cellText(page.values, row, decoder);
    eachMatch(pattern, valueText, (start, end) => out.push(make(row, cols[1], start, end)));
  };
}
