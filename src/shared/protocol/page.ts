import { z } from 'zod';

export type { PageKind } from '../caps';

export type TypeClass = 'number' | 'text' | 'boolean' | 'temporal' | 'binary' | 'json' | 'other';

export const typeClassSchema = z.enum([
  'number',
  'text',
  'boolean',
  'temporal',
  'binary',
  'json',
  'other',
]);

export interface ColumnDescriptor {
  name: string;
  /** The server's own type name, verbatim: 'numeric(20,6)', 'varchar(50)', 'longblob'. */
  dataType: string;
  typeClass: TypeClass;
  nullable: boolean;
  isPrimaryKey: boolean;
}

export const columnDescriptorSchema = z.object({
  name: z.string(),
  dataType: z.string(),
  typeClass: typeClassSchema,
  nullable: z.boolean(),
  isPrimaryKey: z.boolean(),
});

/**
 * One column of one page. Three exactly-sized buffers (D4) and no per-row object:
 *   text of row i = utf8.decode(data.subarray(offsets[i], offsets[i + 1]))
 *   row i is NULL  = (nulls[i >> 3] & (1 << (i & 7))) !== 0
 * A NULL row has offsets[i] === offsets[i+1]; an empty string does too, which is why the
 * bitset is the only thing that distinguishes them (§8.5 requires they render differently).
 */
export interface TextColumnChunk {
  data: Uint8Array; // packed UTF-8, exactly-sized ArrayBuffer
  offsets: Uint32Array; // rowCount + 1 entries
  nulls: Uint8Array; // ceil(rowCount / 8) bytes
  /** Sorted row indices whose text was cut at MAX_CELL_BYTES. Usually empty. */
  truncated: Uint32Array;
}

export interface PagePosition {
  /** Absolute row offset when the page came from an offset query; null for a keyset page. */
  offset: number | null;
  pageSize: number;
  hasMore: boolean;
  nextToken: string | null;
  prevToken: string | null;
  strategy: 'keyset' | 'offset';
}

export const pagePositionSchema = z.object({
  offset: z.number().int().nullable(),
  pageSize: z.number().int(),
  hasMore: z.boolean(),
  nextToken: z.string().nullable(),
  prevToken: z.string().nullable(),
  strategy: z.enum(['keyset', 'offset']),
});

export interface TabularPage {
  kind: 'tabular';
  columns: ColumnDescriptor[];
  rowCount: number;
  chunks: TextColumnChunk[]; // index-aligned with `columns`
  position: PagePosition;
  truncatedCells: number;
  /** Measured, not estimated — this is what L2 budgets against (§2.2). */
  byteSize: number;
  fetchedAt: number; // epoch ms
}

/**
 * P8 widens this to `TabularPage | DocumentPage`, P9 adds `KeyValuePage`, P10 `StreamPage`
 * (D5). Switch on `page.kind` everywhere, even though there is one arm today — that is what
 * makes widening additive instead of a rewrite.
 */
export type Page = TabularPage;

export const MAX_CELL_BYTES = 64 * 1024;
export const MAX_PAGE_SIZE = 10_000;

function bitsetBytes(rowCount: number): number {
  return Math.ceil(rowCount / 8);
}

function binarySearch(sorted: Uint32Array, target: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = sorted[mid];
    if (v === target) return mid;
    if (v < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/**
 * Cuts `bytes` at `maxBytes` on a UTF-8 code-point boundary, never mid-sequence — a split
 * surrogate makes the renderer's decoder emit U+FFFD and the cell looks corrupted.
 */
function truncateUtf8ToBoundary(
  bytes: Uint8Array<ArrayBuffer>,
  maxBytes: number,
): Uint8Array<ArrayBuffer> {
  let end = maxBytes;
  // A continuation byte (10xxxxxx) at `end` means the cut lands mid-sequence; back off to the
  // sequence's leading byte and drop the whole (necessarily incomplete) code point.
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end);
}

export function isNull(chunk: TextColumnChunk, row: number): boolean {
  return (chunk.nulls[row >> 3] & (1 << (row & 7))) !== 0;
}

export function cellText(chunk: TextColumnChunk, row: number, decoder: TextDecoder): string {
  return decoder.decode(chunk.data.subarray(chunk.offsets[row], chunk.offsets[row + 1]));
}

export function isTruncated(chunk: TextColumnChunk, row: number): boolean {
  return binarySearch(chunk.truncated, row) >= 0;
}

export function chunkByteSize(chunk: TextColumnChunk): number {
  return (
    chunk.data.byteLength +
    chunk.offsets.byteLength +
    chunk.nulls.byteLength +
    chunk.truncated.byteLength
  );
}

// Per-column object overhead estimate: name + dataType at 2 bytes/char (UTF-16) + a fixed
// allowance for the descriptor's own object shape. A measurement, not a guess — L2's budget
// is only as honest as this number (§4a).
const COLUMN_ENVELOPE_BYTES = 64;

export function pageByteSize(page: TabularPage): number {
  let total = 0;
  for (let i = 0; i < page.chunks.length; i++) {
    const chunk = page.chunks[i];
    const column = page.columns[i];
    total += chunkByteSize(chunk) + (column.name.length + column.dataType.length) * 2;
    total += COLUMN_ENVELOPE_BYTES;
  }
  return total;
}

/**
 * Accumulates one column's rows into growable scratch and only copies into exactly-sized
 * buffers at `finish()` (D4's corollary: a view over an oversized buffer clones the slack).
 * `reverse()` is honoured entirely inside `finish()` by choosing which row order to copy in —
 * every row's byte range is already addressable via `rowStart`, so no extra buffer is needed.
 */
class ColumnScratch {
  private buffer = new Uint8Array(256);
  private used = 0;
  private readonly rowStart: number[] = [0];
  private readonly isNullRow: boolean[] = [];
  private readonly truncatedRows = new Set<number>();

  private grow(extra: number): void {
    if (this.used + extra <= this.buffer.length) return;
    let size = this.buffer.length * 2;
    while (size < this.used + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buffer.subarray(0, this.used));
    this.buffer = next;
  }

  /** Returns whether this row's value was truncated. */
  appendValue(value: string | null, row: number, encoder: TextEncoder): boolean {
    if (value === null) {
      this.isNullRow.push(true);
      this.rowStart.push(this.used);
      return false;
    }
    this.isNullRow.push(false);
    let bytes = encoder.encode(value);
    let truncated = false;
    if (bytes.length > MAX_CELL_BYTES) {
      bytes = truncateUtf8ToBoundary(bytes, MAX_CELL_BYTES);
      this.truncatedRows.add(row);
      truncated = true;
    }
    this.grow(bytes.length);
    this.buffer.set(bytes, this.used);
    this.used += bytes.length;
    this.rowStart.push(this.used);
    return truncated;
  }

  finish(rowCount: number, reversed: boolean): TextColumnChunk {
    const nulls = new Uint8Array(bitsetBytes(rowCount));
    const offsets = new Uint32Array(rowCount + 1);
    const data = new Uint8Array(this.used);
    const truncated: number[] = [];

    let cursor = 0;
    for (let newRow = 0; newRow < rowCount; newRow++) {
      const oldRow = reversed ? rowCount - 1 - newRow : newRow;
      const start = this.rowStart[oldRow];
      const end = this.rowStart[oldRow + 1];
      const len = end - start;
      if (len > 0) data.set(this.buffer.subarray(start, end), cursor);
      cursor += len;
      offsets[newRow + 1] = cursor;
      if (this.isNullRow[oldRow]) nulls[newRow >> 3] |= 1 << (newRow & 7);
      if (this.truncatedRows.has(oldRow)) truncated.push(newRow);
    }
    truncated.sort((a, b) => a - b);
    return { data, offsets, nulls, truncated: new Uint32Array(truncated) };
  }
}

export interface TabularPageBuilder {
  /** One row, one string-or-null per column, in `columns` order. */
  appendRow(values: readonly (string | null)[]): void;
  /** Reverses the accumulated rows before finishing — used by a keyset 'before' page (D7). */
  reverse(): void;
  finish(position: PagePosition): TabularPage;
}

export function createTabularPageBuilder(columns: ColumnDescriptor[]): TabularPageBuilder {
  const scratches = columns.map(() => new ColumnScratch());
  const encoder = new TextEncoder();
  let rowCount = 0;
  let reversed = false;
  let truncatedCells = 0;

  return {
    appendRow(values) {
      if (values.length !== columns.length) {
        throw new Error(`row has ${values.length} values, expected ${columns.length} columns`);
      }
      const row = rowCount;
      for (let i = 0; i < columns.length; i++) {
        if (scratches[i].appendValue(values[i] ?? null, row, encoder)) truncatedCells++;
      }
      rowCount++;
    },
    reverse() {
      reversed = true;
    },
    finish(position) {
      const chunks = scratches.map((s) => s.finish(rowCount, reversed));
      const page: TabularPage = {
        kind: 'tabular',
        columns,
        rowCount,
        chunks,
        position,
        truncatedCells,
        byteSize: 0,
        fetchedAt: Date.now(),
      };
      page.byteSize = pageByteSize(page);
      return page;
    },
  };
}

/**
 * The envelope-only schema (§4a): running Zod over every cell of a 600 000-cell page would
 * cost more than the query. Pair with `assertPageStructure` for the typed-array invariants.
 */
export const pageEnvelopeSchema = z.object({
  kind: z.literal('tabular'),
  columns: z.array(columnDescriptorSchema),
  rowCount: z.number().int().min(0),
  position: pagePositionSchema,
  truncatedCells: z.number().int().min(0),
  byteSize: z.number().int().min(0),
  fetchedAt: z.number(),
});

/** Throws when a chunk's typed arrays disagree with the envelope's `rowCount`. */
export function assertPageStructure(page: TabularPage): void {
  if (page.chunks.length !== page.columns.length) {
    throw new Error(`page has ${page.chunks.length} chunks for ${page.columns.length} columns`);
  }
  for (const chunk of page.chunks) {
    if (!(chunk.data instanceof Uint8Array)) throw new Error('chunk.data is not a Uint8Array');
    if (!(chunk.offsets instanceof Uint32Array)) {
      throw new Error('chunk.offsets is not a Uint32Array');
    }
    if (!(chunk.nulls instanceof Uint8Array)) throw new Error('chunk.nulls is not a Uint8Array');
    if (!(chunk.truncated instanceof Uint32Array)) {
      throw new Error('chunk.truncated is not a Uint32Array');
    }
    if (chunk.offsets.length !== page.rowCount + 1) {
      throw new Error(
        `chunk.offsets has ${chunk.offsets.length} entries, expected ${page.rowCount + 1}`,
      );
    }
    if (chunk.nulls.length !== bitsetBytes(page.rowCount)) {
      throw new Error(
        `chunk.nulls has ${chunk.nulls.length} bytes, expected ${bitsetBytes(page.rowCount)}`,
      );
    }
  }
}
