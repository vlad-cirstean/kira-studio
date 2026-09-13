import { describe, expect, test } from 'bun:test';
import { formatAbsoluteDate, measureAbsoluteDateWidth } from './dateFormat.ts';

describe('formatAbsoluteDate — G21 D6b widest-output invariant', () => {
  /** `measureAbsoluteDateWidth` measures exactly one hard-coded sample and treats its width as
   *  "the widest `formatAbsoluteDate` can produce" — sound only because the format's own shape
   *  ("YYYY-MM-DD HH:MM") never varies in character count, so no other timestamp could measure
   *  wider. Asserted here across a spread of real timestamps (single- and double-digit month/
   *  day/hour/minute, a year boundary, the Unix epoch) rather than assumed. */
  test('every rendered string is exactly 16 characters, regardless of the digits it contains', () => {
    const samples = [
      0, // 1970-01-01 00:00 — the epoch itself, every field its narrowest
      Date.UTC(2024, 11, 30, 22, 48) / 1000, // the widest-sample timestamp itself
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

describe('measureAbsoluteDateWidth — G21 D6b', () => {
  /** Bun's own `bun:test` environment has no DOM — no `document`, no `OffscreenCanvas` (the same
   *  reason `rowSvg.ts`'s DOM-construction half is Playwright-only, not covered here). This
   *  asserts that documented fallback explicitly rather than leaving it implicit: a real
   *  measurement, and the `Math.max(152, …)` floor that makes a `0` here harmless, are both
   *  covered by `graph-columns.spec.ts`. */
  test('returns 0 in an environment with no canvas — the safe fallback CommitGrid.vue floors', () => {
    expect(typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined').toBe(true);
    expect(measureAbsoluteDateWidth('13px sans-serif')).toBe(0);
  });
});
