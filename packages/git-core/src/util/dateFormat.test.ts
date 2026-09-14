import { describe, expect, test } from 'bun:test';
import { formatAbsoluteDate, formatRelativeDate } from './dateFormat.ts';

describe('formatAbsoluteDate — G21 D6b widest-output invariant', () => {
  /** `measureAbsoluteDateWidth` (kept in `@kira/git-ui`, DOM-bound) measures exactly one hard-
   *  coded sample and treats its width as "the widest `formatAbsoluteDate` can produce" — sound
   *  only because the format's own shape ("YYYY-MM-DD HH:MM") never varies in character count, so
   *  no other timestamp could measure wider. Asserted here across a spread of real timestamps
   *  (single- and double-digit month/day/hour/minute, a year boundary, the Unix epoch) rather than
   *  assumed. */
  test('every rendered string is exactly 16 characters, regardless of the digits it contains', () => {
    const samples = [
      0, // 1970-01-01 00:00 — the epoch itself, every field its narrowest
      Date.UTC(2024, 11, 30, 22, 48) / 1000, // the widest-sample timestamp git-ui's own measurer uses
      Date.UTC(2024, 0, 1, 0, 0) / 1000, // new year, midnight
      Date.UTC(1999, 8, 9, 9, 9) / 1000, // single-digit month/day/hour/minute throughout
      Date.UTC(2100, 10, 25, 13, 5) / 1000, // a four-digit year past 2099
    ];
    for (const timestampSeconds of samples) {
      expect(formatAbsoluteDate(timestampSeconds)).toHaveLength(16);
    }
  });

  test('the format matches YYYY-MM-DD HH:MM exactly', () => {
    expect(formatAbsoluteDate(Date.UTC(2024, 2, 14, 9, 41) / 1000)).toBe('2024-03-14 09:41');
  });
});

// P5/P62: a fixed nowMs and a table of deltas -> expected strings, boundary values at each unit
// transition — mirrors memoizedSetter.test.ts's own shape for a tiny pure helper. Moved here from
// the extension's own blameAge.test.ts (P62 D2) alongside the function itself.
describe('formatRelativeDate', () => {
  const now = Date.UTC(2024, 5, 15, 12, 0, 0);
  const nowSeconds = now / 1000;

  test('a future timestamp (clock skew) clamps to "now", never a negative duration', () => {
    expect(formatRelativeDate(nowSeconds + 3600, now)).toBe('now');
  });

  test('under one minute is "now"', () => {
    expect(formatRelativeDate(nowSeconds, now)).toBe('now');
    expect(formatRelativeDate(nowSeconds - 59, now)).toBe('now');
  });

  test('minutes', () => {
    expect(formatRelativeDate(nowSeconds - 60, now)).toBe('1m');
    expect(formatRelativeDate(nowSeconds - 59 * 60, now)).toBe('59m');
  });

  test('hours', () => {
    expect(formatRelativeDate(nowSeconds - 60 * 60, now)).toBe('1h');
    expect(formatRelativeDate(nowSeconds - 23 * 60 * 60, now)).toBe('23h');
  });

  test('days', () => {
    expect(formatRelativeDate(nowSeconds - 24 * 60 * 60, now)).toBe('1d');
    expect(formatRelativeDate(nowSeconds - 29 * 24 * 60 * 60, now)).toBe('29d');
  });

  test('months', () => {
    expect(formatRelativeDate(nowSeconds - 30 * 24 * 60 * 60, now)).toBe('1mo');
    expect(formatRelativeDate(nowSeconds - 11 * 30 * 24 * 60 * 60, now)).toBe('11mo');
  });

  test('years', () => {
    expect(formatRelativeDate(nowSeconds - 365 * 24 * 60 * 60, now)).toBe('1y');
    expect(formatRelativeDate(nowSeconds - 2 * 365 * 24 * 60 * 60, now)).toBe('2y');
  });
});
