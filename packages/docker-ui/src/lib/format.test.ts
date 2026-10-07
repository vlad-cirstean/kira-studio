import { describe, expect, test } from 'bun:test';
import { formatPercent, formatSize } from './format';

describe('formatSize', () => {
  test('steps units at 1024 with one decimal under 100, none above', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(1023)).toBe('1023 B');
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(40.9 * 1024 ** 2)).toBe('40.9 MB');
    expect(formatSize(341.4 * 1024 ** 2)).toBe('341 MB');
    expect(formatSize(16 * 1024 ** 3)).toBe('16.0 GB');
  });

  test('rounding up to 1024 rolls into the next unit', () => {
    expect(formatSize(1024 ** 2 - 1)).toBe('1.0 MB');
    expect(formatSize(1023.6 * 1024 ** 2)).toBe('1.0 GB');
  });

  test('clamps negatives and the largest unit', () => {
    expect(formatSize(-5)).toBe('0 B');
    expect(formatSize(3 * 1024 ** 5)).toBe('3072 TB');
  });
});

describe('formatPercent', () => {
  test('whole numbers from 100%', () => {
    expect(formatPercent(46.14)).toBe('46.1%');
    expect(formatPercent(230.4)).toBe('230%');
  });
});
