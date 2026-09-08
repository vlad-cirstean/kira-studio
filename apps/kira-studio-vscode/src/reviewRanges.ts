/**
 * G15 D5/D6 — pure interval algebra plus the two coordinate mappings the editor-side marking
 * controller needs (`selectionToRange`, `hunkChangeBlock`). Imports only types from `@kira/git-ipc`
 * and nothing from `vscode`, which is what lets this run under plain `bun test` (D10) and be shared
 * by `reviewMarking.ts` without pulling an extension host into either.
 *
 * This algebra is presentation-only (F9): it decides which icon a hunk gets, which of the two
 * toolbar buttons shows, and what a hover says. G11 D10's server-side union/subtract is what
 * actually computes the stored state — the client never predicts it and never writes
 * `reviewedRanges` from this module's output.
 */
import type { DiffHunk, LineRange } from '@kira/git-ipc';

/** A plain `{start,end}×{line,character}` shape — `vscode.Selection` narrowed to what
 *  `selectionToRange` needs, so this module needs no `vscode` import. */
export interface SelectionShape {
  readonly start: { readonly line: number; readonly character: number };
  readonly end: { readonly line: number; readonly character: number };
}

/** Drops invalid ranges (non-integer, `start < 1`, `end < start`), sorts by `start`, and merges
 *  overlapping AND adjacent ranges (`end + 1 === next.start`) into one. */
export function normalizeRanges(ranges: readonly LineRange[]): readonly LineRange[] {
  const valid = ranges.filter(
    (r) => Number.isInteger(r.start) && Number.isInteger(r.end) && r.start >= 1 && r.end >= r.start,
  );
  if (valid.length === 0) return [];
  const sorted = [...valid].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: LineRange[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 1) {
      if (r.end > last.end) merged[merged.length - 1] = { start: last.start, end: r.end };
    } else {
      merged.push({ start: r.start, end: r.end });
    }
  }
  return merged;
}

export function unionRanges(
  a: readonly LineRange[],
  b: readonly LineRange[],
): readonly LineRange[] {
  return normalizeRanges([...a, ...b]);
}

/** Subtracts `b` from `a`, splitting a range in two when `b` cuts out its middle and dropping a
 *  range entirely when `b` covers it. Both inputs are normalized first, so overlap/adjacency in
 *  either one never produces a wrong split. */
export function subtractRanges(
  a: readonly LineRange[],
  b: readonly LineRange[],
): readonly LineRange[] {
  const minuend = normalizeRanges(a);
  const subtrahend = normalizeRanges(b);
  const result: LineRange[] = [];
  for (const range of minuend) {
    let start = range.start;
    const end = range.end;
    for (const cut of subtrahend) {
      if (cut.end < start || cut.start > end) continue;
      if (cut.start > start) result.push({ start, end: cut.start - 1 });
      start = Math.max(start, cut.end + 1);
      if (start > end) break;
    }
    if (start <= end) result.push({ start, end });
  }
  return result;
}

/** Clamps every range into `1..lineCount`, dropping any that fall entirely outside it — a
 *  selection past the last line of a document VS Code padded is not a range the server should be
 *  asked to store (D5). */
export function clampRanges(ranges: readonly LineRange[], lineCount: number): readonly LineRange[] {
  const clamped: LineRange[] = [];
  for (const r of normalizeRanges(ranges)) {
    const start = Math.max(r.start, 1);
    const end = Math.min(r.end, lineCount);
    if (start <= end) clamped.push({ start, end });
  }
  return clamped;
}

/** How much of `target` is covered by `ranges` — the presentation-only question of whether a hunk
 *  or a selection reads as reviewed. Sums overlap length rather than walking line by line. */
export function coverage(
  target: LineRange,
  ranges: readonly LineRange[],
): 'none' | 'partial' | 'full' {
  if (target.end < target.start) return 'none';
  const targetLength = target.end - target.start + 1;
  let covered = 0;
  for (const r of normalizeRanges(ranges)) {
    const start = Math.max(r.start, target.start);
    const end = Math.min(r.end, target.end);
    if (start <= end) covered += end - start + 1;
  }
  if (covered <= 0) return 'none';
  return covered >= targetLength ? 'full' : 'partial';
}

/** D5's selection -> `LineRange` mapping: the modified pane's own line numbers, taken directly —
 *  the document IS `<branchTip>:<path>` (F6) and `LineRange` is defined in exactly those
 *  coordinates, so there is no projection to do. */
export function selectionToRange(sel: SelectionShape): LineRange {
  const startLine0 = sel.start.line;
  // A downward drag that lands at column 0 of the next line does not include that line — VS Code's
  // own convention for a full-line selection, and what git.stageSelectedRanges does with the same
  // gesture. A single-line selection is never collapsed away by this rule.
  const endLine0 =
    sel.end.character === 0 && sel.end.line > sel.start.line ? sel.end.line - 1 : sel.end.line;
  return { start: startLine0 + 1, end: Math.max(endLine0, startLine0) + 1 };
}

/** D6: the changed-line span of a hunk, not its context. The span runs from the first to the last
 *  line that both changed (not `context`) and has a new-side image — a `del` line's `newLine` is
 *  `undefined` (`contract.ts:110-118`), so a pure-deletion hunk (only `del` lines) yields
 *  `undefined`: there is no branch-tip line left to hang review state on, which is correct rather
 *  than a gap (G11 D10's own projection already drops ranges whose lines were deleted). */
export function hunkChangeBlock(hunk: DiffHunk): LineRange | undefined {
  let start: number | undefined;
  let end: number | undefined;
  for (const line of hunk.lines) {
    if (line.kind === 'context') continue;
    if (line.newLine === undefined) continue;
    if (start === undefined) start = line.newLine;
    end = line.newLine;
  }
  return start === undefined || end === undefined ? undefined : { start, end };
}
