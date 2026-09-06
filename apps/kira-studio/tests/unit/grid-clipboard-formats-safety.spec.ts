// P21 round 3 findings:
//  - architecture/security #10: a cell is untrusted database content, but CSV/TSV copy handed it
//    straight to a spreadsheet — a value starting with `=`/`+`/`-`/`@` is evaluated as a formula on
//    paste (CWE-1236).
//  - functional #6: the TSV branch of parseDelimited kept the trailing empty row the CSV branch
//    already dropped, silently blanking or inserting an extra row on paste.
//  - functional #7: rowsToTsv/columnsToTsv emitted tab/newline verbatim, so a cell containing
//    either corrupted the row layout on a copy→paste round trip.
import { describe, expect, test } from 'bun:test';
import {
  columnsToTsv,
  parseDelimited,
  rowsToCsv,
  rowsToTsv,
} from '../../frontend/src/views/shared/clipboardFormats';

describe('formula-injection guard (finding 10)', () => {
  test('rowsToCsv prefixes a leading = + - @ with a single quote', () => {
    const rows = [
      { columns: ['a'], values: { a: '=IMPORTXML(A1)' } },
      { columns: ['a'], values: { a: '+1' } },
      { columns: ['a'], values: { a: '-1' } },
      { columns: ['a'], values: { a: '@SUM(A1)' } },
      { columns: ['a'], values: { a: 'plain text' } },
    ];
    const lines = rows.map((r) => rowsToCsv([r]));
    expect(lines[0]).toBe("'=IMPORTXML(A1)");
    expect(lines[1]).toBe("'+1");
    expect(lines[2]).toBe("'-1");
    expect(lines[3]).toBe("'@SUM(A1)");
    expect(lines[4]).toBe('plain text');
  });

  test('rowsToCsv still quotes the guarded value when it also needs CSV quoting', () => {
    const line = rowsToCsv([{ columns: ['a'], values: { a: '=A,B' } }]);
    expect(line).toBe('"\'=A,B"');
  });

  test('rowsToTsv prefixes a formula-shaped value the same way', () => {
    const line = rowsToTsv([{ columns: ['a', 'b'], values: { a: '=1+1', b: 'ok' } }]);
    expect(line).toBe("'=1+1\tok");
  });

  test('columnsToTsv prefixes a formula-shaped value the same way', () => {
    const line = columnsToTsv([0], [0], () => ({ text: '=1+1', isNull: false }));
    expect(line).toBe("'=1+1");
  });
});

describe('TSV escaping and round-trip (finding 7)', () => {
  test('rowsToTsv quotes a value containing an embedded tab or newline', () => {
    const line = rowsToTsv([{ columns: ['a', 'b'], values: { a: 'line one\nline two', b: 'x' } }]);
    expect(line).toBe('"line one\nline two"\tx');
  });

  test('copying a row with an embedded tab, then pasting, does not shift later columns', () => {
    const tsv = rowsToTsv([{ columns: ['a', 'b'], values: { a: 'has\ttab', b: 'second' } }]);
    const parsed = parseDelimited(tsv);
    expect(parsed).toEqual([['has\ttab', 'second']]);
  });

  test('copying a row with an embedded newline, then pasting, does not split it into two rows', () => {
    const tsv = rowsToTsv([
      { columns: ['a', 'b'], values: { a: 'line one\nline two', b: 'second' } },
    ]);
    const parsed = parseDelimited(tsv);
    expect(parsed).toEqual([['line one\nline two', 'second']]);
  });

  test('columnsToTsv round-trips an embedded newline the same way', () => {
    const tsv = columnsToTsv([0], [0, 1], (_r, c) =>
      c === 0 ? { text: 'line one\nline two', isNull: false } : { text: 'second', isNull: false },
    );
    expect(parseDelimited(tsv)).toEqual([['line one\nline two', 'second']]);
  });
});

describe('TSV trailing empty row (finding 6)', () => {
  test('a trailing newline (as every real clipboard TSV source adds) does not produce a bogus extra row', () => {
    expect(parseDelimited('a\tb\nc\td\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  test('a single trailing newline on one row is also dropped, not just multi-row input', () => {
    expect(parseDelimited('a\tb\n')).toEqual([['a', 'b']]);
  });

  test('a genuinely blank trailing row (two newlines) still round-trips as an empty row when it is not just the delimiter tail', () => {
    // Two consecutive newlines mean one real blank line in the middle, which must survive — only
    // the *very last* all-empty row (the delimiter's own trailing newline) is dropped.
    expect(parseDelimited('a\tb\n\nc\td\n')).toEqual([['a', 'b'], [''], ['c', 'd']]);
  });
});
