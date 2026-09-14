import { describe, expect, test } from 'bun:test';
import { measureAbsoluteDateWidth } from './dateFormat.ts';

// P62 D2: formatAbsoluteDate/formatRelativeDate's own tests moved to
// packages/git-core/src/util/dateFormat.test.ts alongside the functions themselves. Only
// measureAbsoluteDateWidth (DOM-bound canvas measurement) stays here.
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
