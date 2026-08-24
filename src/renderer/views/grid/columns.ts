import type { ColumnDescriptor, TabularPage } from '@shared/protocol/page';
import { cellText, isNull } from '@shared/protocol/page';

const MIN_WIDTH = 64;
const MAX_WIDTH = 480;
const CELL_PADDING = 20; // px, both sides combined plus a little breathing room
const SAMPLE_ROWS = 50;

let measureCtx: CanvasRenderingContext2D | null = null;

function getMeasureCtx(): CanvasRenderingContext2D {
  if (measureCtx) return measureCtx;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context is unavailable — cannot measure column widths');
  const root = getComputedStyle(document.documentElement);
  const family = root.getPropertyValue('--kira-font-family').trim() || 'monospace';
  const size = root.getPropertyValue('--kira-font-size').trim() || '12px';
  ctx.font = `${size} ${family}`;
  measureCtx = ctx;
  return ctx;
}

/** Measures the wider of the header and a sample of the first rows, clamped to [64, 480] px. */
export function initialWidths(page: TabularPage): Record<string, number> {
  const ctx = getMeasureCtx();
  const decoder = new TextDecoder();
  const widths: Record<string, number> = {};
  const sampleCount = Math.min(SAMPLE_ROWS, page.rowCount);

  for (let c = 0; c < page.columns.length; c++) {
    const column = page.columns[c];
    const chunk = page.chunks[c];
    let max = ctx.measureText(column.name).width;
    for (let r = 0; r < sampleCount; r++) {
      if (isNull(chunk, r)) continue;
      const width = ctx.measureText(cellText(chunk, r, decoder)).width;
      if (width > max) max = width;
    }
    widths[column.name] = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(max + CELL_PADDING)));
  }
  return widths;
}

/**
 * Prefix sums over `order`, recomputed only when widths or order change (a computed() in the
 * caller) — not per scroll frame, which visibleColumnRange() below is cheap enough for.
 */
export function columnOffsets(order: string[], widths: Record<string, number>): number[] {
  const offsets: number[] = [0];
  let cursor = 0;
  for (const name of order) {
    cursor += widths[name] ?? MIN_WIDTH;
    offsets.push(cursor);
  }
  return offsets;
}

export interface ColumnRange {
  startIndex: number;
  endIndex: number;
}

// The row axis has had overscan since P12; the column axis had none (F3 in P29's plan) — the
// asymmetry the "worse horizontally" report traces to. Buffer in pixels, not a column count: a
// column is 40-480 px wide, so "N columns of overscan" is a different distance on every table.
export function visibleColumnRange(
  scrollLeft: number,
  viewportWidth: number,
  offsets: number[],
  /** Extra rendered width on each side. */
  overscanPx: number,
  /** Hard cap per side, so a table of narrow columns can't multiply the DOM without bound. */
  maxOverscanColumns: number,
): ColumnRange {
  const n = offsets.length - 1;
  if (n <= 0) return { startIndex: 0, endIndex: 0 };

  // The exact visible range, no buffer — same binary-search-then-linear-walk shape as before.
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (offsets[mid + 1] <= scrollLeft) lo = mid + 1;
    else hi = mid;
  }
  let end = lo;
  while (end < n && offsets[end] < scrollLeft + viewportWidth) end++;

  // Expand each side by columns whose combined width covers overscanPx, capped independently.
  let startIndex = lo;
  let leftPx = 0;
  let leftCount = 0;
  while (startIndex > 0 && leftPx < overscanPx && leftCount < maxOverscanColumns) {
    startIndex--;
    leftPx += offsets[startIndex + 1] - offsets[startIndex];
    leftCount++;
  }
  let endIndex = end;
  let rightPx = 0;
  let rightCount = 0;
  while (endIndex < n && rightPx < overscanPx && rightCount < maxOverscanColumns) {
    rightPx += offsets[endIndex + 1] - offsets[endIndex];
    endIndex++;
    rightCount++;
  }

  return { startIndex, endIndex };
}

// §8.5's type-aware right-alignment for numerics.
export function alignmentFor(descriptor: ColumnDescriptor): 'left' | 'right' {
  return descriptor.typeClass === 'number' ? 'right' : 'left';
}

/** The display order: stored order filtered to live columns, then any new columns appended. */
export function resolveColumnOrder(page: TabularPage, stored: string[] | null): string[] {
  const names = page.columns.map((c) => c.name);
  if (!stored) return names;
  const known = new Set(names);
  const kept = stored.filter((n) => known.has(n));
  const missing = names.filter((n) => !kept.includes(n));
  return [...kept, ...missing];
}

// Pages are frozen and stable by reference (page.ts's setPage), so a WeakMap keyed by the page
// itself memoises the name -> index lookup exactly once per page — the single mapping §0 note 4
// exists to guarantee, kept O(1) per call so it stays cheap on the render path.
const nameIndexCache = new WeakMap<TabularPage, Map<string, number>>();

function nameIndexFor(page: TabularPage): Map<string, number> {
  let map = nameIndexCache.get(page);
  if (!map) {
    map = new Map(page.columns.map((c, i) => [c.name, i]));
    nameIndexCache.set(page, map);
  }
  return map;
}

/** Display position -> index into page.columns/page.chunks. -1 when the name is gone. */
export function pageColumnIndexFor(page: TabularPage, order: string[], displayCol: number): number {
  const name = order[displayCol];
  if (name === undefined) return -1;
  return nameIndexFor(page).get(name) ?? -1;
}
