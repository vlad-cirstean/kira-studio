import {
  CELL_NULL,
  CELL_TRUNCATED,
  MAX_CELL_BYTES,
  type ColumnEncoding,
  type PageColumn,
  type TabularPage,
} from '../../shared/page';
import { AdapterError } from '../adapters/errors';

// The adapter-agnostic columnar encoder (P2 D2–D5). It knows nothing about any driver: rows arrive
// as arrays of driver-native values and leave as per-column typed buffers with a byte count exact
// enough for L2 to budget on. Both SQL adapters feed it the same way, which is what makes the
// second adapter cheap.
//
// Encoding contract per column family:
//   f64    Float64Array; null → flag + 0; a non-null value that becomes NaN is a bug (the encoding
//          choice was wrong), so the column falls back to utf8 rather than writing NaN.
//   i64    BigInt64Array; BigInt(v); out-of-range → fall back to utf8.
//   bool   Uint8Array of 0/1; accepts true/false, 't'/'f', '1'/'0', 1/0.
//   utf8   text, clamped at MAX_CELL_BYTES on a code-point boundary (CELL_TRUNCATED set when cut).
//   bytes  raw bytes, same offsets structure, same clamp, no encoding.

export interface EncodeColumnSpec {
  name: string;
  dataType: string;
  encoding: ColumnEncoding;
}

export interface EncodeInput {
  columns: EncodeColumnSpec[];
  /** Rows as arrays, in `columns` order. Values are driver-native: string | number | bigint |
   *  Uint8Array | null | boolean. */
  rows: readonly unknown[][];
}

export type EncodedColumns = Pick<
  TabularPage,
  'columns' | 'rowCount' | 'bytes' | 'truncatedCells'
>;

const encoder = new TextEncoder();

// One 64 KiB scratch per call stream, reused across the row loop (encodeInto fills from the start).
const scratch = new Uint8Array(MAX_CELL_BYTES);

function isBigInt64ArraySafe(v: bigint): boolean {
  return v >= BigInt('0x8000000000000000') * -1n && v <= BigInt('0x7FFFFFFFFFFFFFFF');
}

function flagsBytes(count: number): Uint8Array {
  return new Uint8Array(count);
}

function utf8Cell(value: unknown): { data: Uint8Array; truncated: boolean } {
  if (typeof value === 'string') {
    if (value.length === 0) return { data: new Uint8Array(0), truncated: false };
    const total = encoder.encodeInto(value, scratch);
    // `read` is the count of code units fully consumed — encodeInto stops on a code-point boundary,
    // so a 4-byte emoji straddling the cap is dropped whole, never halved. Truncation means the
    // input was not fully consumed, which is what matters, not whether the scratch filled up.
    if (total.read === value.length) {
      return { data: scratch.slice(0, total.written), truncated: false };
    }
    return { data: scratch.slice(0, total.written), truncated: true };
  }
  if (value === null) return { data: new Uint8Array(0), truncated: false };
  // Objects/bigints reach here only if an adapter failed to set raw parsers (D4) — log once.
  const text =
    typeof value === 'bigint'
      ? value.toString()
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  if (text.length === 0) return { data: new Uint8Array(0), truncated: false };
  const total = encoder.encodeInto(text, scratch);
  if (total.read === text.length) {
    return { data: scratch.slice(0, total.written), truncated: false };
  }
  return { data: scratch.slice(0, total.written), truncated: true };
}

function bytesCell(value: unknown): { data: Uint8Array; truncated: boolean } {
  if (value == null) return { data: new Uint8Array(0), truncated: false };
  const buf = value instanceof Uint8Array ? value : new Uint8Array(0);
  if (buf.byteLength <= MAX_CELL_BYTES) return { data: buf, truncated: false };
  return { data: buf.slice(0, MAX_CELL_BYTES), truncated: true };
}

function encodeColumn(
  spec: EncodeColumnSpec,
  rows: readonly unknown[][],
  colIndex: number,
  rowCount: number,
): PageColumn {
  const flags = flagsBytes(rowCount);
  const encoding = spec.encoding;

  if (encoding === 'utf8' || encoding === 'bytes') {
    const chunks: Uint8Array[] = new Array(rowCount);
    let total = 0;
    let truncatedCells = 0;
    for (let i = 0; i < rowCount; i++) {
      const value = rows[i][colIndex];
      if (value == null) {
        flags[i] |= CELL_NULL;
        chunks[i] = new Uint8Array(0);
        continue;
      }
      const cell = encoding === 'bytes' ? bytesCell(value) : utf8Cell(value);
      if (cell.truncated) {
        flags[i] |= CELL_TRUNCATED;
        truncatedCells += 1;
      }
      chunks[i] = cell.data;
      total += cell.data.byteLength;
    }
    const offsets = new Int32Array(rowCount + 1);
    const data = new Uint8Array(total);
    let cursor = 0;
    for (let i = 0; i < rowCount; i++) {
      offsets[i] = cursor;
      data.set(chunks[i], cursor);
      cursor += chunks[i].byteLength;
    }
    offsets[rowCount] = cursor;
    if (cursor >= 2 ** 31 - 1) {
      throw new AdapterError('E_QUERY', 'page too large, reduce page size');
    }
    return {
      name: spec.name,
      dataType: spec.dataType,
      encoding,
      flags,
      data,
      offsets,
    };
  }

  if (encoding === 'bool') {
    const values = new Uint8Array(rowCount);
    for (let i = 0; i < rowCount; i++) {
      const value = rows[i][colIndex];
      if (value == null) {
        flags[i] |= CELL_NULL;
        values[i] = 0;
        continue;
      }
      values[i] = toBool(value);
    }
    return { name: spec.name, dataType: spec.dataType, encoding, flags, values };
  }

  if (encoding === 'f64') {
    const values = new Float64Array(rowCount);
    let corrupted = false;
    for (let i = 0; i < rowCount; i++) {
      const value = rows[i][colIndex];
      if (value == null) {
        flags[i] |= CELL_NULL;
        values[i] = 0;
        continue;
      }
      const n = typeof value === 'number' ? value : Number(value);
      if (Number.isNaN(n)) {
        // Non-null NaN means the encoding choice was wrong for the data (e.g. a '1e400' text that
        // the driver delivered as a string). Fall back the whole column to utf8 rather than writing
        // silent NaNs.
        corrupted = true;
        break;
      }
      values[i] = n;
    }
    if (corrupted) {
      return encodeColumn({ ...spec, encoding: 'utf8' }, rows, colIndex, rowCount);
    }
    return { name: spec.name, dataType: spec.dataType, encoding, flags, values };
  }

  // i64
  const values = new BigInt64Array(rowCount);
  for (let i = 0; i < rowCount; i++) {
    const value = rows[i][colIndex];
    if (value == null) {
      flags[i] |= CELL_NULL;
      values[i] = 0n;
      continue;
    }
    const b = typeof value === 'bigint' ? value : BigInt(value as string | number);
    if (!isBigInt64ArraySafe(b)) {
      return encodeColumn({ ...spec, encoding: 'utf8' }, rows, colIndex, rowCount);
    }
    values[i] = b;
  }
  return { name: spec.name, dataType: spec.dataType, encoding, flags, values };
}

function toBool(value: unknown): 0 | 1 {
  if (value === true || value === 't' || value === '1' || value === 1) return 1;
  if (value === false || value === 'f' || value === '0' || value === 0) return 0;
  // Anything else (e.g. a driver sent 'TRUE'/'FALSE') — be tolerant but not silent.
  const lower = String(value).toLowerCase();
  if (lower === 'true' || lower === 't') return 1;
  return 0;
}

export function encodeTabular(input: EncodeInput): EncodedColumns {
  const rowCount = input.rows.length;
  const columns: PageColumn[] = input.columns.map((spec, i) =>
    encodeColumn(spec, input.rows, i, rowCount),
  );
  let bytes = 0;
  let truncatedCells = 0;
  for (const col of columns) {
    bytes += col.flags.byteLength;
    if (col.values) bytes += col.values.byteLength;
    if (col.data) bytes += col.data.byteLength;
    if (col.offsets) bytes += col.offsets.byteLength;
    truncatedCells += col.flags.reduce(
      (n, flag) => n + (flag & CELL_TRUNCATED ? 1 : 0),
      0,
    );
  }
  return { columns, rowCount, bytes, truncatedCells };
}
