import { describe, expect, test } from 'bun:test';
import { exactCount, formatChangeCount } from './countFormat.ts';

describe('formatChangeCount', () => {
  test('leaves anything under 1000 as-is', () => {
    expect(formatChangeCount(0)).toBe('0');
    expect(formatChangeCount(42)).toBe('42');
    expect(formatChangeCount(999)).toBe('999');
  });

  test('abbreviates thousands with K, dropping a trailing .0', () => {
    expect(formatChangeCount(1000)).toBe('1K');
    expect(formatChangeCount(1500)).toBe('1.5K');
    expect(formatChangeCount(12_345)).toBe('12.3K');
  });

  test('abbreviates millions with M', () => {
    expect(formatChangeCount(1_000_000)).toBe('1M');
    expect(formatChangeCount(2_500_000)).toBe('2.5M');
  });

  test('abbreviates billions with B', () => {
    expect(formatChangeCount(1_000_000_000)).toBe('1B');
  });

  test('preserves the sign for a negative count', () => {
    expect(formatChangeCount(-1500)).toBe('-1.5K');
  });
});

describe('exactCount', () => {
  test('comma-groups the exact number, for the tooltip', () => {
    expect(exactCount(1234)).toBe('1,234');
    expect(exactCount(42)).toBe('42');
  });
});
