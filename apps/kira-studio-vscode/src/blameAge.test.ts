import { describe, expect, test } from 'bun:test';
import { blameAge } from './blameAge.ts';

// P5: a fixed nowMs and a table of deltas -> expected strings, boundary values at each unit
// transition — mirrors memoizedSetter.test.ts's own shape for a tiny pure host-side helper.
describe('blameAge', () => {
  const now = Date.UTC(2024, 5, 15, 12, 0, 0);
  const nowSeconds = now / 1000;

  test('a future timestamp (clock skew) clamps to "now", never a negative duration', () => {
    expect(blameAge(nowSeconds + 3600, now)).toBe('now');
  });

  test('under one minute is "now"', () => {
    expect(blameAge(nowSeconds, now)).toBe('now');
    expect(blameAge(nowSeconds - 59, now)).toBe('now');
  });

  test('minutes', () => {
    expect(blameAge(nowSeconds - 60, now)).toBe('1m');
    expect(blameAge(nowSeconds - 59 * 60, now)).toBe('59m');
  });

  test('hours', () => {
    expect(blameAge(nowSeconds - 60 * 60, now)).toBe('1h');
    expect(blameAge(nowSeconds - 23 * 60 * 60, now)).toBe('23h');
  });

  test('days', () => {
    expect(blameAge(nowSeconds - 24 * 60 * 60, now)).toBe('1d');
    expect(blameAge(nowSeconds - 29 * 24 * 60 * 60, now)).toBe('29d');
  });

  test('months', () => {
    expect(blameAge(nowSeconds - 30 * 24 * 60 * 60, now)).toBe('1mo');
    expect(blameAge(nowSeconds - 11 * 30 * 24 * 60 * 60, now)).toBe('11mo');
  });

  test('years', () => {
    expect(blameAge(nowSeconds - 365 * 24 * 60 * 60, now)).toBe('1y');
    expect(blameAge(nowSeconds - 2 * 365 * 24 * 60 * 60, now)).toBe('2y');
  });
});
