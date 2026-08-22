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

export function visibleColumnRange(
  scrollLeft: number,
  viewportWidth: number,
  offsets: number[],
): ColumnRange {
  const n = offsets.length - 1;
  if (n <= 0) return { startIndex: 0, endIndex: 0 };
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (offsets[mid + 1] <= scrollLeft) lo = mid + 1;
    else hi = mid;
  }
  let end = lo;
  while (end < n && offsets[end] < scrollLeft + viewportWidth) end++;
  return { startIndex: lo, endIndex: end };
}

// §8.5's type-aware right-alignment for numerics.
export function alignmentFor(descriptor: ColumnDescriptor): 'left' | 'right' {
  return descriptor.typeClass === 'number' ? 'right' : 'left';
}
