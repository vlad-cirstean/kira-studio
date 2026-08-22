import {
  CELL_NULL,
  CELL_TRUNCATED,
  type ColumnEncoding,
  type PageColumn,
  type TabularPage,
} from '@shared/page';

// Structural validation of an inbound TabularPage (P2 §3.1). Not Zod — the page carries megabytes
// of typed arrays and a Zod parse per page would defeat D2's whole point. This is the single
// deliberate, documented exception to the Zod-at-every-boundary standing rule. It checks `kind`,
// `rowCount`, and that each column's buffer lengths agree with `rowCount`, then freezes the
// wrapper so a later mutation is impossible rather than merely discouraged.

const ENCODINGS = new Set<ColumnEncoding>(['f64', 'i64', 'bool', 'utf8', 'bytes']);

function isTypedArray(v: unknown): boolean {
  return (
    v instanceof Uint8Array ||
    v instanceof Float64Array ||
    v instanceof BigInt64Array ||
    v instanceof Int32Array
  );
}

function validateColumn(col: unknown, rowCount: number): PageColumn {
  const c = col as Partial<PageColumn>;
  if (!c || typeof c !== 'object') throw new Error('invalid page column');
  if (typeof c.name !== 'string') throw new Error('column missing name');
  if (typeof c.dataType !== 'string') throw new Error('column missing dataType');
  if (typeof c.encoding !== 'string' || !ENCODINGS.has(c.encoding as ColumnEncoding)) {
    throw new Error(`column ${c.name} has bad encoding`);
  }
  if (!c.flags || !isTypedArray(c.flags) || c.flags.length !== rowCount) {
    throw new Error(`column ${c.name} flags length != rowCount`);
  }
  if (c.encoding === 'f64' || c.encoding === 'i64' || c.encoding === 'bool') {
    const values = c.values as Uint8Array | Float64Array | BigInt64Array | undefined;
    if (!values || !isTypedArray(values) || values.length !== rowCount) {
      throw new Error(`column ${c.name} values length != rowCount`);
    }
  } else {
    const data = c.data as Uint8Array | undefined;
    const offsets = c.offsets as Int32Array | undefined;
    if (!data || !(data instanceof Uint8Array)) throw new Error(`column ${c.name} missing data`);
    if (!offsets || !(offsets instanceof Int32Array) || offsets.length !== rowCount + 1) {
      throw new Error(`column ${c.name} offsets length != rowCount + 1`);
    }
  }
  return c as PageColumn;
}

export function assertTabularPage(v: unknown): TabularPage {
  const p = v as Partial<TabularPage>;
  if (!p || typeof p !== 'object') throw new Error('invalid page');
  if (p.kind !== 'tabular') throw new Error(`expected tabular page, got ${p.kind}`);
  if (typeof p.rowCount !== 'number' || p.rowCount < 0) throw new Error('bad rowCount');
  if (!Array.isArray(p.columns) || p.columns.length === 0) throw new Error('bad columns');
  const columns = p.columns.map((c) => validateColumn(c, p.rowCount as number));
  if (typeof p.bytes !== 'number' || p.bytes < 0) throw new Error('bad bytes');
  return Object.freeze({
    ...p,
    columns: Object.freeze(columns),
    kind: 'tabular',
    rowCount: p.rowCount as number,
    offset: (p.offset as number | null | undefined) ?? null,
    nextToken: (p.nextToken as string | null | undefined) ?? null,
    prevToken: (p.prevToken as string | null | undefined) ?? null,
    bytes: p.bytes as number,
    truncatedCells: (p.truncatedCells as number | undefined) ?? 0,
    elapsedMs: (p.elapsedMs as number | undefined) ?? 0,
    fromCache: p.fromCache === true,
  } as TabularPage);
}

// ---------------------------------------------------------------------------
// PageView — the renderer's only window onto a page's buffers (D22). Plain class, never wrapped in
// ref/reactive. Cell text is decoded ON DEMAND with no cache: a visible viewport is ≈50×14 = 700
// cells and TextDecoder.decode over a 20-byte subarray is ~0.2 µs, so a full repaint costs ~0.15 ms
// against an 8 ms budget. A cache would add invalidation surface for a rounding error — do not
// "optimize" it.
// ---------------------------------------------------------------------------

export interface GridColumn {
  name: string;
  dataType: string;
  /** display order position */
  index: number;
  left: number;
  width: number;
  align: 'left' | 'right' | 'center';
}

const decoder = new TextDecoder();

function typeAlign(encoding: ColumnEncoding, dataType: string): 'left' | 'right' | 'center' {
  if (encoding === 'bool') return 'center';
  if (encoding === 'f64' || encoding === 'i64') return 'right';
  // numeric/DECIMAL are utf8-encoded but numerically aligned (§8.5).
  if (/\b(numeric|decimal|real|double|float|money)\b/i.test(dataType)) return 'right';
  return 'left';
}

export class PageView {
  readonly rowCount: number;
  /** Absolute offset of row 0 (gutter numbering); null when unknown. */
  readonly offset: number | null;
  /** Display-order column descriptors. The array is frozen; descriptors are mutated in place by
   *  resize/relayout — never replace the array. */
  readonly columns: readonly GridColumn[];
  readonly totalWidth: number;
  readonly gutterWidth = 48;

  // Mutable width store so setWidth/autoFit work without rebuilding the view. The version bump is
  // the grid's job via the tab store.
  private readonly widthByCol = new Map<string, number>();

  constructor(
    private readonly page: TabularPage,
    columnOrder: string[],
    widths: Record<string, number>,
  ) {
    this.rowCount = page.rowCount;
    this.offset = page.offset;
    const order = columnOrder.length > 0 ? columnOrder : page.columns.map((c) => c.name);
    const defaultWidths = PageView.deterministicWidths(page.columns);
    const cols: GridColumn[] = [];
    let left = this.gutterWidth;
    for (const name of order) {
      const col = page.columns.find((c) => c.name === name);
      if (!col) continue;
      const width = widths[name] ?? defaultWidths.get(name) ?? 120;
      this.widthByCol.set(name, width);
      cols.push({
        name,
        dataType: col.dataType,
        index: cols.length,
        left,
        width,
        align: typeAlign(col.encoding, col.dataType),
      });
      left += width;
    }
    this.columns = cols;
    this.totalWidth = left;
  }

  // D28: deterministic initial widths from the declared type and header length, never content
  // measurement — a measuring pass over 5 000 rows before first paint is precisely what the frame
  // budget forbids.
  private static deterministicWidths(columns: PageColumn[]): Map<string, number> {
    const widths = new Map<string, number>();
    for (const col of columns) {
      const typeWidth = (col.dataType.length + 1) * 7;
      const headerWidth = col.name.length * 7 + 12;
      widths.set(col.name, Math.min(320, Math.max(80, Math.max(headerWidth, typeWidth))));
    }
    return widths;
  }

  private colIndex(col: number): number {
    return col;
  }

  isNull(row: number, col: number): boolean {
    const c = this.page.columns[this.colIndex(col)];
    if (!c || !c.flags) return false;
    return (c.flags[row] & CELL_NULL) !== 0;
  }

  isTruncated(row: number, col: number): boolean {
    const c = this.page.columns[this.colIndex(col)];
    if (!c || !c.flags) return false;
    return (c.flags[row] & CELL_TRUNCATED) !== 0;
  }

  /** Decoded on demand; no memoization (see class comment). */
  text(row: number, col: number): string {
    const c = this.page.columns[this.colIndex(col)];
    if (!c) return '';
    if ((c.flags[row] & CELL_NULL) !== 0) return '';
    const encoding = c.encoding;
    if (encoding === 'f64') {
      const v = (c.values as Float64Array)[row];
      return Number.isInteger(v) ? String(v) : String(v);
    }
    if (encoding === 'i64') {
      return (c.values as BigInt64Array)[row].toString();
    }
    if (encoding === 'bool') {
      return (c.values as Uint8Array)[row] === 1 ? 'true' : 'false';
    }
    // utf8 / bytes — decode the subarray.
    const data = c.data as Uint8Array;
    const offsets = c.offsets as Int32Array;
    return decoder.decode(data.subarray(offsets[row], offsets[row + 1]));
  }

  /** P3's hook: the raw typed value for a cell. */
  raw(row: number, col: number): number | bigint | string | boolean | Uint8Array | null {
    const c = this.page.columns[this.colIndex(col)];
    if (!c) return null;
    if ((c.flags[row] & CELL_NULL) !== 0) return null;
    switch (c.encoding) {
      case 'f64':
        return (c.values as Float64Array)[row];
      case 'i64':
        return (c.values as BigInt64Array)[row];
      case 'bool':
        return (c.values as Uint8Array)[row] === 1 ? true : false;
      case 'bytes': {
        const data = c.data as Uint8Array;
        const offsets = c.offsets as Int32Array;
        return data.subarray(offsets[row], offsets[row + 1]);
      }
      default:
        return this.text(row, col);
    }
  }

  setWidth(name: string, px: number): void {
    const col = this.columns.find((c) => c.name === name);
    if (!col) return;
    this.widthByCol.set(name, Math.round(px));
    this.relayout();
  }

  private relayout(): void {
    let left = this.gutterWidth;
    for (const col of this.columns) {
      const width = this.widthByCol.get(col.name) ?? col.width;
      col.left = left;
      col.width = width;
      left += width;
    }
    (this as { totalWidth: number }).totalWidth = left;
  }

  autoFit(name: string, sampleRows: number): number {
    const col = this.columns.find((c) => c.name === name);
    if (!col) return 80;
    let max = name.length * 7;
    const stop = Math.min(this.rowCount, sampleRows);
    for (let r = 0; r < stop; r++) {
      max = Math.max(max, this.text(r, col.index).length * 7);
    }
    return Math.min(480, Math.max(80, max + 16));
  }
}
