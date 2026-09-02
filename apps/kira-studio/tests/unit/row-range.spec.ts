import { describe, expect, test } from 'bun:test';
import {
  BASE_LEAD_PX,
  BASE_TRAIL_PX,
  type RowRangeExtractorConfig,
  rowRangeExtractor,
} from '../../frontend/src/views/shared/page/columns';

// P22 iter2 D3: velocity-adaptive, direction-biased row overscan — cursor/pagination-style
// arithmetic with several interacting boundary cases (AGENTS.md's own bar for a dedicated unit
// test), and the one place D3(a)'s "byte-identical to today at rest" claim is actually provable —
// see docs/v1.1/plans/P22-webview-scroll-performance-iter2-rendering.md §5 D3/§7.1.

const ROW_HEIGHT = 28; // BASE_LEAD_PX/BASE_TRAIL_PX (560) / 28 = 20 rows per side at rest.
const BASE_ROWS = BASE_LEAD_PX / ROW_HEIGHT;

function cfg(overrides: Partial<RowRangeExtractorConfig> = {}): RowRangeExtractorConfig {
  return {
    baseLeadPx: BASE_LEAD_PX,
    baseTrailPx: BASE_TRAIL_PX,
    leadFrames: 6,
    maxLeadPx: 2400,
    cellBudget: 2200,
    ...overrides,
  };
}

describe('rowRangeExtractor (P22 iter2 D3) — velocity-adaptive, direction-biased row overscan', () => {
  test('1. D3(a): zero velocity is byte-identical to a symmetric ±BASE_ROWS window, either direction', () => {
    const range = { startIndex: 100, endIndex: 120, count: 100_000 };
    const forward = rowRangeExtractor(range, ROW_HEIGHT, 0, 1, 10, cfg());
    const backward = rowRangeExtractor(range, ROW_HEIGHT, 0, -1, 10, cfg());
    const atRest = rowRangeExtractor(range, ROW_HEIGHT, 0, 0, 10, cfg());
    const expected = Array.from(
      { length: range.endIndex + BASE_ROWS - (range.startIndex - BASE_ROWS) + 1 },
      (_, i) => range.startIndex - BASE_ROWS + i,
    );
    expect(forward).toEqual(expected);
    expect(backward).toEqual(expected);
    expect(atRest).toEqual(expected);
  });

  test('2. forward velocity extends the end (lead) side only, trail stays at baseline', () => {
    const range = { startIndex: 100, endIndex: 120, count: 100_000 };
    // leadPx = 560 + 200*6 = 1760 -> 63 rows lead; trail stays 20.
    const out = rowRangeExtractor(range, ROW_HEIGHT, 200, 1, 10, cfg());
    expect(out[0]).toBe(range.startIndex - BASE_ROWS);
    expect(out[out.length - 1]).toBe(range.endIndex + Math.ceil(1760 / ROW_HEIGHT));
  });

  test('3. backward velocity extends the start (lead) side only, trail stays at baseline', () => {
    const range = { startIndex: 500, endIndex: 520, count: 100_000 };
    const out = rowRangeExtractor(range, ROW_HEIGHT, 200, -1, 10, cfg());
    expect(out[0]).toBe(range.startIndex - Math.ceil(1760 / ROW_HEIGHT));
    expect(out[out.length - 1]).toBe(range.endIndex + BASE_ROWS);
  });

  test('4. leadPx clamps at maxLeadPx regardless of how large velocity gets', () => {
    const range = { startIndex: 1000, endIndex: 1020, count: 100_000 };
    const huge = rowRangeExtractor(range, ROW_HEIGHT, 100_000, 1, 10, cfg());
    const atCap = rowRangeExtractor(range, ROW_HEIGHT, 100, 1, 10, cfg({ maxLeadPx: 2400 }));
    // 100px/frame * 6 frames = 600, +560 base = 1160 < 2400, so not yet capped — huge must exceed it.
    expect(huge[huge.length - 1] - range.endIndex).toBeGreaterThan(
      atCap[atCap.length - 1] - range.endIndex,
    );
    expect(huge[huge.length - 1]).toBe(range.endIndex + Math.ceil(cfg().maxLeadPx / ROW_HEIGHT));
  });

  test('5. clamps at 0 on the start side and count-1 on the end side', () => {
    const out = rowRangeExtractor(
      { startIndex: 0, endIndex: 5, count: 10 },
      ROW_HEIGHT,
      0,
      0,
      10,
      cfg(),
    );
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(9);
  });

  test('6. an empty table extracts no range', () => {
    expect(
      rowRangeExtractor({ startIndex: 0, endIndex: 0, count: 0 }, ROW_HEIGHT, 500, 1, 10, cfg()),
    ).toEqual([]);
  });

  test('7. D3(c): the cell budget caps the *extra* lead only — the baseline is always granted in full', () => {
    // 20 columns, 11 visible rows: budgetRows = floor(2200/20) = 110; remaining after baseline+
    // visible = 110 - 11 - 20 (trail) - 20 (lead baseline) = 59 extra rows grantable. Uncapped
    // wanted lead at this velocity would be maxLeadPx (2400px = 86 rows), 66 rows of *extra* —
    // more than the 59 the budget allows, so the cap must bind at exactly baseline + 59.
    const range = { startIndex: 1000, endIndex: 1010, count: 100_000 }; // 11 visible rows
    const out = rowRangeExtractor(range, ROW_HEIGHT, 456, 1, 20, cfg());
    expect(out[0]).toBe(range.startIndex - BASE_ROWS); // trail: untouched by the cap
    const leadRows = out[out.length - 1] - range.endIndex;
    expect(leadRows).toBe(BASE_ROWS + 59);
    // Confirms the cap is actually doing something here, not coincidentally equal to uncapped.
    expect(leadRows).toBeLessThan(Math.ceil(cfg().maxLeadPx / ROW_HEIGHT));
  });

  test('8. a wide-enough table still grants full baseline even when total budget is razor-thin', () => {
    // cellBudget 2200 / 400 columns = 5 rows total — less than baseline (20) on ONE side alone.
    // The extra-lead cap floors at 0 (never negative), so lead == baseline, exactly like at rest.
    const range = { startIndex: 1000, endIndex: 1010, count: 100_000 };
    const out = rowRangeExtractor(range, ROW_HEIGHT, 456, 1, 400, cfg());
    expect(out[0]).toBe(range.startIndex - BASE_ROWS);
    expect(out[out.length - 1]).toBe(range.endIndex + BASE_ROWS);
  });
});
