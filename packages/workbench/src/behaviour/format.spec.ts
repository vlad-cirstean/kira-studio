import { describe, expect, test } from 'bun:test';
import {
  formatAbsoluteUtc,
  formatAgeCompact,
  formatBytes,
  formatDuration,
  formatElapsed,
} from './format';

describe('formatBytes rounding edges', () => {
  test('carries into the next unit instead of printing 1024', () => {
    expect(formatBytes(1023.95 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1023.6)).toBe('1.0 KB');
  });

  test('switches from one decimal to none at 99.95', () => {
    expect(formatBytes(99.9 * 1024)).toBe('99.9 KB');
    expect(formatBytes(99.96 * 1024)).toBe('100 KB');
  });

  test('negative clamps to zero; top unit does not carry', () => {
    expect(formatBytes(-5)).toBe('0 B');
    expect(formatBytes(2048 * 1024 ** 4)).toBe('2048 TB');
  });
});

describe('formatDuration unit boundaries', () => {
  test('ms, seconds, minutes, hours', () => {
    expect(formatDuration(999)).toBe('999 ms');
    expect(formatDuration(1000)).toBe('1.0 s');
    expect(formatDuration(59_949)).toBe('59.9 s');
    expect(formatDuration(59_950)).toBe('1m 0s');
    expect(formatDuration(125_000)).toBe('2m 5s');
    expect(formatDuration(3_600_000)).toBe('1h 0m');
    expect(formatDuration(3_725_000)).toBe('1h 2m');
  });
});

describe('formatElapsed', () => {
  test('m:ss then h:mm:ss from the first hour', () => {
    expect(formatElapsed(59_999)).toBe('0:59');
    expect(formatElapsed(3_599_000)).toBe('59:59');
    expect(formatElapsed(3_600_000)).toBe('1:00:00');
  });
});

describe('formatAbsoluteUtc widest-output invariant', () => {
  test('every rendered string is exactly 16 characters', () => {
    const samples = [
      0,
      Date.UTC(2024, 11, 30, 22, 48) / 1000,
      Date.UTC(2024, 0, 1, 0, 0) / 1000,
      Date.UTC(1999, 8, 9, 9, 9) / 1000,
      Date.UTC(2100, 10, 25, 13, 5) / 1000,
    ];
    for (const s of samples) expect(formatAbsoluteUtc(s)).toHaveLength(16);
  });

  test('matches YYYY-MM-DD HH:MM', () => {
    expect(formatAbsoluteUtc(Date.UTC(2024, 2, 14, 9, 41) / 1000)).toBe('2024-03-14 09:41');
  });
});

describe('formatAgeCompact unit boundaries', () => {
  const now = Date.UTC(2024, 5, 15, 12, 0, 0);
  const sec = now / 1000;
  const age = (delta: number): string => formatAgeCompact(sec - delta, now);

  test('future and under a minute clamp to <1m', () => {
    expect(age(-3600)).toBe('<1m');
    expect(age(0)).toBe('<1m');
    expect(age(59)).toBe('<1m');
  });

  test('minutes, hours, days', () => {
    expect(age(60)).toBe('1m');
    expect(age(59 * 60)).toBe('59m');
    expect(age(3600)).toBe('1h');
    expect(age(23 * 3600)).toBe('23h');
    expect(age(86400)).toBe('1d');
    expect(age(29 * 86400)).toBe('29d');
  });

  test('months, years', () => {
    expect(age(30 * 86400)).toBe('1mo');
    expect(age(11 * 30 * 86400)).toBe('11mo');
    expect(age(365 * 86400)).toBe('1y');
    expect(age(2 * 365 * 86400)).toBe('2y');
  });
});
