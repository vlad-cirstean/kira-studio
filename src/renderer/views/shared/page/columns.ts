import type { ColumnDescriptor, TabularPage, TypeClass } from '@shared/protocol/page';
import { cellText, isNull } from '@shared/protocol/page';
import type { Range } from '@tanstack/vue-virtual';
import { typeClassColor } from '../../../theme/icons';
import { typeDescription } from '../typeGlossary';

const MIN_WIDTH = 64;
const MAX_WIDTH = 480;
const CELL_PADDING = 20; // px, both sides combined plus a little breathing room
const SAMPLE_ROWS = 50;

// P48 F9: DataGrid.vue's own gutter width and ConsoleResultGrid.vue's copy of it, spelled a
// third way as a bare `56` in the latter's own CSS — one constant behind all three.
export const GUTTER_WIDTH = 56;
// P48 F9: the 96px fallback both grids' own widths computeds used when neither a stored width
// nor a measured one is available yet.
export const DEFAULT_COLUMN_WIDTH = 96;
// P49 F9/D4: the pixel overscan budget and per-side column cap DataGrid.vue's own column
// virtualizer used, now shared with ConsoleResultGrid.vue's own column axis too.
export const OVERSCAN_PX = 560;
/** Per side. Bounds the DOM when columns are narrow enough that 560 px is a dozen of them. */
export const MAX_OVERSCAN_COLUMNS = 12;

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

/** Drops the memoized measuring context so the next initialWidths() call re-reads the current
 *  appearance tokens (P31 D11) — without this, a font change leaves every unstored column sized
 *  for whatever font was active when this module first measured, for the rest of the session. */
export function resetMeasureCtx(): void {
  measureCtx = null;
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
 * caller) — not per scroll frame, which columnRangeExtractor() below is cheap enough for.
 */
export function columnOffsets(order: string[], widths: Record<string, number>): number[] {
  const offsets: number[] = [0];
  let cursor = 0;
  for (const name of order) {
    cursor += widths[name] ?? DEFAULT_COLUMN_WIDTH;
    offsets.push(cursor);
  }
  return offsets;
}

// P47 D5: @tanstack/vue-virtual's own `rangeExtractor` seam, replacing visibleColumnRange (P29).
// TanStack already computes the exact visible range (range.startIndex/endIndex, the latter
// **inclusive**, unlike this function's old {startIndex, endIndex} contract where endIndex was
// exclusive) — only the pixel-budget expansion below is this app's own. The row axis has had
// overscan since P12; the column axis had none (F3 in P29's plan) — the asymmetry the "worse
// horizontally" report traces to. Buffer in pixels, not a column count: a column is 40-480 px
// wide, so "N columns of overscan" is a different distance on every table.
export function columnRangeExtractor(
  range: Pick<Range, 'startIndex' | 'endIndex'>,
  offsets: number[],
  /** Extra rendered width on each side. */
  overscanPx: number,
  /** Hard cap per side, so a table of narrow columns can't multiply the DOM without bound. */
  maxOverscanColumns: number,
): number[] {
  const n = offsets.length - 1;
  if (n <= 0) return [];

  // Expand each side by columns whose combined width covers overscanPx, capped independently.
  let startIndex = range.startIndex;
  let leftPx = 0;
  let leftCount = 0;
  while (startIndex > 0 && leftPx < overscanPx && leftCount < maxOverscanColumns) {
    startIndex--;
    leftPx += offsets[startIndex + 1] - offsets[startIndex];
    leftCount++;
  }
  let last = range.endIndex;
  let rightPx = 0;
  let rightCount = 0;
  while (last < n - 1 && rightPx < overscanPx && rightCount < maxOverscanColumns) {
    last++;
    rightPx += offsets[last + 1] - offsets[last];
    rightCount++;
  }

  const out: number[] = [];
  for (let i = startIndex; i <= last; i++) out.push(i);
  return out;
}

// P49 F3/D4: TanStack's default observeElementRect reports the scroll element's border-box size
// (ResizeObserver's borderBoxSize/getBoundingClientRect), which does NOT subtract a visible
// scrollbar's own thickness the way clientWidth/clientHeight do — on a wide table that discrepancy
// put a virtualizer's overscan boundary on a knife's edge (P47 F3). Measuring clientWidth/
// clientHeight instead is DataGrid.vue's own fix, hoisted here so ConsoleResultGrid.vue's column
// virtualizer shares it rather than growing its own copy.
export function observeScrollElementRect(
  instance: { scrollElement: Element | null },
  cb: (rect: { width: number; height: number }) => void,
): (() => void) | undefined {
  const el = instance.scrollElement as HTMLElement | null;
  if (!el) return undefined;
  const handler = () => cb({ width: el.clientWidth, height: el.clientHeight });
  handler();
  const observer = new ResizeObserver(handler);
  observer.observe(el);
  return () => observer.disconnect();
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

// P48 F7: the column-header tooltip object DataGrid.vue and ConsoleResultGrid.vue each built —
// deliberately the same shape (P42 D19/D20's own comment), differing only in whether a DB
// comment line is available to fold into `body`. `dataType` is passed in rather than read off
// `col` directly: DataGrid.vue overlays a DESCRIBE-derived dataType where the console has none.
export function columnHeaderTooltip(
  col: { name: string; typeClass: TypeClass },
  dataType: string,
  comment?: string | null,
): { title: string; meta?: string; metaColor?: string; body?: string } {
  const description = dataType ? typeDescription(dataType) : null;
  return {
    title: col.name,
    meta: dataType || undefined,
    metaColor: typeClassColor(col.typeClass) || undefined,
    body: [description, comment].filter((line): line is string => !!line).join('\n') || undefined,
  };
}
