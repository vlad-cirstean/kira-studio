/**
 * G15 D10 — the one new test file this phase adds. `normalizeRanges`/`unionRanges`/`subtractRanges`
 * are interval arithmetic with genuinely interacting rules (overlap vs. adjacency vs. containment
 * vs. a subtraction that splits one range into two), `selectionToRange` is boundary arithmetic
 * with an off-by-one rule that is wrong in both directions if misread, and `hunkChangeBlock`'s
 * `newLine === undefined` handling is the difference between a correct block and a silently
 * shifted one. All pure, no `vscode` import, runs under plain `bun test`.
 */
import { describe, expect, test } from 'bun:test';
import type { DiffHunk, DiffLine, LineRange } from '@kira/git-ipc';
import {
  clampRanges,
  coverage,
  hunkChangeBlock,
  normalizeRanges,
  selectionToRange,
  subtractRanges,
  unionRanges,
} from './reviewRanges.ts';

function line(
  kind: DiffLine['kind'],
  oldLine: number | undefined,
  newLine: number | undefined,
): DiffLine {
  return { kind, text: '', oldLine, newLine, noNewlineAtEof: false };
}

function hunk(
  oldStart: number,
  oldLines: number,
  newStart: number,
  newLines: number,
  lines: readonly DiffLine[],
): DiffHunk {
  return { oldStart, oldLines, newStart, newLines, heading: '', lines };
}

describe('normalizeRanges', () => {
  test('drops invalid ranges (non-integer, start < 1, end < start)', () => {
    expect(
      normalizeRanges([
        { start: 1.5, end: 2 },
        { start: 0, end: 3 },
        { start: 5, end: 4 },
        { start: 2, end: 4 },
      ]),
    ).toEqual([{ start: 2, end: 4 }]);
  });

  test('sorts and merges overlapping ranges', () => {
    expect(
      normalizeRanges([
        { start: 10, end: 20 },
        { start: 1, end: 5 },
        { start: 15, end: 25 },
      ]),
    ).toEqual([
      { start: 1, end: 5 },
      { start: 10, end: 25 },
    ]);
  });

  test('merges adjacent ranges (end + 1 === next.start)', () => {
    expect(
      normalizeRanges([
        { start: 1, end: 5 },
        { start: 6, end: 10 },
      ]),
    ).toEqual([{ start: 1, end: 10 }]);
  });

  test('does not merge ranges with a gap between them', () => {
    expect(
      normalizeRanges([
        { start: 1, end: 5 },
        { start: 7, end: 10 },
      ]),
    ).toEqual([
      { start: 1, end: 5 },
      { start: 7, end: 10 },
    ]);
  });

  test('a fully-contained range disappears into the containing one', () => {
    expect(
      normalizeRanges([
        { start: 1, end: 20 },
        { start: 5, end: 10 },
      ]),
    ).toEqual([{ start: 1, end: 20 }]);
  });
});

describe('unionRanges', () => {
  test('is normalizeRanges over the concatenation', () => {
    expect(unionRanges([{ start: 1, end: 5 }], [{ start: 4, end: 8 }])).toEqual([
      { start: 1, end: 8 },
    ]);
  });
});

describe('subtractRanges', () => {
  test('a cut in the middle splits one range into two', () => {
    expect(subtractRanges([{ start: 1, end: 20 }], [{ start: 10, end: 12 }])).toEqual([
      { start: 1, end: 9 },
      { start: 13, end: 20 },
    ]);
  });

  test('a cut covering the whole range empties it', () => {
    expect(subtractRanges([{ start: 5, end: 10 }], [{ start: 1, end: 20 }])).toEqual([]);
  });

  test('a cut at the start trims from the front', () => {
    expect(subtractRanges([{ start: 1, end: 10 }], [{ start: 1, end: 3 }])).toEqual([
      { start: 4, end: 10 },
    ]);
  });

  test('a cut at the end trims from the back', () => {
    expect(subtractRanges([{ start: 1, end: 10 }], [{ start: 8, end: 10 }])).toEqual([
      { start: 1, end: 7 },
    ]);
  });

  test('a non-overlapping cut leaves the range untouched', () => {
    expect(subtractRanges([{ start: 1, end: 5 }], [{ start: 10, end: 15 }])).toEqual([
      { start: 1, end: 5 },
    ]);
  });

  test('several cuts against one range each carve their own piece out', () => {
    expect(
      subtractRanges(
        [{ start: 1, end: 30 }],
        [
          { start: 5, end: 7 },
          { start: 15, end: 17 },
        ],
      ),
    ).toEqual([
      { start: 1, end: 4 },
      { start: 8, end: 14 },
      { start: 18, end: 30 },
    ]);
  });
});

describe('clampRanges', () => {
  test('clamps a range past lineCount', () => {
    expect(clampRanges([{ start: 5, end: 200 }], 50)).toEqual([{ start: 5, end: 50 }]);
  });

  test('drops a range that starts past lineCount entirely', () => {
    expect(clampRanges([{ start: 60, end: 80 }], 50)).toEqual([]);
  });

  test('leaves an in-bounds range untouched', () => {
    expect(clampRanges([{ start: 1, end: 10 }], 50)).toEqual([{ start: 1, end: 10 }]);
  });
});

describe('coverage', () => {
  const target: LineRange = { start: 10, end: 20 };

  test('none — no overlap at all', () => {
    expect(coverage(target, [{ start: 1, end: 5 }])).toBe('none');
  });

  test('full — the target is fully covered by one or more ranges', () => {
    expect(coverage(target, [{ start: 1, end: 30 }])).toBe('full');
    expect(coverage(target, [{ start: 10, end: 20 }])).toBe('full');
  });

  test('partial — only some of the target is covered', () => {
    expect(coverage(target, [{ start: 15, end: 25 }])).toBe('partial');
  });

  test('an empty ranges list is none', () => {
    expect(coverage(target, [])).toBe('none');
  });

  // G31 round-2 performance review, finding #4: coverage() no longer normalizes `ranges` itself
  // (it used to, on every call — pure repetition, since its one real caller always passes
  // already-normalized wire data). It still gives the right answer for genuinely normalized
  // input, sorted or not (order alone never affects the sum-of-overlaps below), and its own doc
  // comment now states the precondition explicitly: normalize first if `ranges` might not be.
  test('an already-normalized ranges list still gives the right answer regardless of order', () => {
    expect(
      coverage(target, [
        { start: 5, end: 12 },
        { start: 18, end: 25 },
      ]),
    ).toBe('partial');
    expect(
      coverage(target, [
        { start: 18, end: 25 },
        { start: 5, end: 12 },
      ]),
    ).toBe('partial');
  });

  // Documents WHY the precondition matters, not a desired behavior: duplicate/overlapping
  // ranges (what normalizeRanges would have merged away) double-count their overlap, which can
  // push a genuinely partial coverage over the "full" threshold. state.reviewedRanges (every
  // real caller's own input) can never be shaped like this — every server-side origin ends in
  // Normalize — so this is a documentation-as-test guard against the precondition quietly
  // becoming false, not a case any production code path is expected to hit.
  test('violating the normalized-input precondition can report "full" for a genuinely partial target', () => {
    const wideTarget: LineRange = { start: 1, end: 100 };
    const overlapping: readonly LineRange[] = [
      { start: 1, end: 60 },
      { start: 1, end: 60 }, // a duplicate — normalizeRanges would have merged this away.
    ];
    expect(coverage(wideTarget, overlapping)).toBe('full'); // wrong: only 60 of 100 lines covered.
    expect(coverage(wideTarget, normalizeRanges(overlapping))).toBe('partial'); // correct once normalized.
  });
});

describe('selectionToRange', () => {
  test('a single-line selection', () => {
    expect(
      selectionToRange({ start: { line: 4, character: 2 }, end: { line: 4, character: 9 } }),
    ).toEqual({ start: 5, end: 5 });
  });

  test('an empty (collapsed cursor) selection is the cursor’s own line', () => {
    expect(
      selectionToRange({ start: { line: 7, character: 3 }, end: { line: 7, character: 3 } }),
    ).toEqual({ start: 8, end: 8 });
  });

  test('a full-line drag ending at column 0 of the next line excludes that line', () => {
    expect(
      selectionToRange({ start: { line: 2, character: 0 }, end: { line: 5, character: 0 } }),
    ).toEqual({ start: 3, end: 5 });
  });

  test('a multi-line drag ending mid-line includes the last line', () => {
    expect(
      selectionToRange({ start: { line: 2, character: 0 }, end: { line: 5, character: 4 } }),
    ).toEqual({ start: 3, end: 6 });
  });

  test('a single-line selection ending at column 0 on the same line is not collapsed away', () => {
    expect(
      selectionToRange({ start: { line: 2, character: 0 }, end: { line: 2, character: 0 } }),
    ).toEqual({ start: 3, end: 3 });
  });
});

describe('hunkChangeBlock', () => {
  test('the span from the first to the last changed line with a new-side image', () => {
    // @@ -8,3 +8,4 @@ — context, del, add, add, context
    const h = hunk(8, 3, 8, 4, [
      line('context', 8, 8),
      line('del', 9, undefined),
      line('add', undefined, 9),
      line('add', undefined, 10),
      line('context', 10, 11),
    ]);
    expect(hunkChangeBlock(h)).toEqual({ start: 9, end: 10 });
  });

  test('a pure-deletion hunk (only del lines) yields undefined', () => {
    const h = hunk(5, 3, 5, 0, [
      line('del', 5, undefined),
      line('del', 6, undefined),
      line('del', 7, undefined),
    ]);
    expect(hunkChangeBlock(h)).toBeUndefined();
  });

  test('the first changed line is not newStart when the hunk opens with context', () => {
    // @@ -1,5 +1,5 @@ with two leading context lines before the first real change.
    const h = hunk(1, 5, 1, 5, [
      line('context', 1, 1),
      line('context', 2, 2),
      line('add', undefined, 3),
      line('context', 4, 4),
      line('context', 5, 5),
    ]);
    expect(hunkChangeBlock(h)).toEqual({ start: 3, end: 3 });
  });

  test('a pure addition hunk spans exactly its added lines', () => {
    const h = hunk(3, 0, 4, 3, [
      line('add', undefined, 4),
      line('add', undefined, 5),
      line('add', undefined, 6),
    ]);
    expect(hunkChangeBlock(h)).toEqual({ start: 4, end: 6 });
  });
});
