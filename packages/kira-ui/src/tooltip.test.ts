import { describe, expect, test } from 'bun:test';
import { isWithinRearmWindow } from './tooltip.ts';

// G20 §4.1: extracted purely so the rearm-window arithmetic gets a real test — neither this port
// nor the app-side original it was ported from (`workbench/state/tooltip.ts`) has ever had one.
describe('isWithinRearmWindow', () => {
  test('true immediately after closing', () => {
    expect(isWithinRearmWindow(1000, 1000, 300)).toBe(true);
  });

  test('true just under the rearm window', () => {
    expect(isWithinRearmWindow(1299, 1000, 300)).toBe(true);
  });

  test('false once the rearm window has elapsed', () => {
    expect(isWithinRearmWindow(1300, 1000, 300)).toBe(false);
  });

  test('false well past the rearm window', () => {
    expect(isWithinRearmWindow(5000, 1000, 300)).toBe(false);
  });
});
