import { describe, expect, test } from 'bun:test';
import { formatBytes, formatDuration, formatElapsed } from './format';

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
