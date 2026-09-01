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
  /** P36 D28: a GENERATED/computed column (SQLite VIRTUAL/STORED, ClickHouse
   *  MATERIALIZED/ALIAS) — the server fills it in, an explicit value is refused. The renderer's
   *  own insert paths (add row, duplicate-as-insert, paste) skip it; `false` where an adapter
   *  never detects the concept (console results, or an adapter that hasn't wired detection yet). */
  generated: boolean;
}

export const columnDescriptorSchema = z.object({
  name: z.string(),
  dataType: z.string(),
  typeClass: typeClassSchema,
  nullable: z.boolean(),
  isPrimaryKey: z.boolean(),
  generated: z.boolean(),
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
  /** P43 iter3 F28/D47: informational and unread — a repo-wide grep (`grep -rn "position\.pageSize"
   *  src/ tests/`) finds no consumer. Every adapter writes it (some as the size requested, some as
   *  the size actually served — the two disagree by design where an adapter overshoots or clamps,
   *  e.g. redis/read.ts's SCAN-family round overshoot), but nothing downstream reads it back, so
   *  "requested or served?" has no observable answer. Not removed: it is on this validated wire
   *  schema and on every page every adapter builds, so deleting it would be an eleven-adapter
   *  change to delete something harmless. */
  pageSize: number;
  hasMore: boolean;
  nextToken: string | null;
  prevToken: string | null;
  strategy: 'keyset' | 'offset' | 'cursor' | 'offsetWindow' | 'batch';
}

export const pagePositionSchema = z.object({
  offset: z.number().int().nullable(),
  pageSize: z.number().int(),
  hasMore: z.boolean(),
  nextToken: z.string().nullable(),
  prevToken: z.string().nullable(),
  strategy: z.enum(['keyset', 'offset', 'cursor', 'offsetWindow', 'batch']),
});

// P48 F23: a page that is the whole result — no offset, no continuation, nothing more to fetch.
// Ten adapters' console/read paths wrote this six-field literal out by hand, its only variable
// being pageSize; the wire shape lives here beside its own schema, not under engine/adapters/,
// since callers span SQL and non-SQL adapters alike.
export function unpagedPosition(rowCount: number): PagePosition {
  return {
    offset: 0,
    pageSize: rowCount,
    hasMore: false,
    nextToken: null,
    prevToken: null,
    strategy: 'offset',
  };
}

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
 * One document per row: `ids`/`bodies` are fixed semantic columns (not a caller-supplied
 * projection like TabularPage's `columns`) reusing the exact same TextColumnChunk codec —
 * `ids` holds each document's `_id` as EJSON text, `bodies` the full document as EJSON text.
 */
export interface DocumentPage {
  kind: 'document';
  position: PagePosition;
  ids: TextColumnChunk;
  bodies: TextColumnChunk;
  rowCount: number;
  byteSize: number;
  fetchedAt: number; // epoch ms
}

/**
 * One row per element of the key (hash field, list index, set/zset member, stream entry id) —
 * or a single row for a string. `fields`/`values` are fixed semantic columns reusing the exact
 * same TextColumnChunk codec as DocumentPage's `ids`/`bodies`. TTL/memory/type are whole-key
 * metadata, not per-row.
 *
 * P17 reuses this exact shape for a single s3 object (`redisType: 'object'`): `fields`/`values`
 * carry the object's metadata (ContentType, ContentLength, LastModified, ETag, StorageClass, ...)
 * plus, for an object at or under `OBJECT_BODY_PREVIEW_BYTES` (P33 D4), a synthetic `Body` row for
 * its (possibly truncated) text content — a flat field/value listing is exactly what a hash-like
 * key already renders, and s3's own tree (bucket → prefix → object, '/'-delimited) already mirrors
 * redis's own namespace tree (db → namespace, ':'-delimited) closely enough that browsing one
 * object's contents needs no new page kind. `ttlMs` is always null for an s3 object (no such
 * concept there); `memoryBytes` (P33 D5) carries the object's real `ContentLength` instead —
 * `KeyValueView.vue`'s existing size badge and its edit-size gate both read it from here.
 */
export interface KeyValuePage {
  kind: 'keyvalue';
  position: PagePosition;
  redisType: 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream' | 'object';
  ttlMs: number | null;
  memoryBytes: number | null;
  fields: TextColumnChunk;
  values: TextColumnChunk;
  rowCount: number;
  byteSize: number;
  fetchedAt: number; // epoch ms
}

/**
 * One row per message/record. `keys`/`headers`/`attrs`/`timestamps`/`bodies` are fixed semantic
 * columns reusing the exact same TextColumnChunk codec as DocumentPage's `ids`/`bodies` — `attrs`
 * is the one column whose meaning differs per engine (partition/offset JSON for Kafka, system
 * attributes JSON for SQS, per §8.9). `visibilityTimeoutSeconds` is SQS-only whole-page metadata
 * (null for Kafka), mirroring KeyValuePage's ttlMs/memoryBytes precedent.
 */
export interface StreamPage {
  kind: 'stream';
  position: PagePosition;
  keys: TextColumnChunk;
  headers: TextColumnChunk;
  attrs: TextColumnChunk;
  timestamps: TextColumnChunk;
  bodies: TextColumnChunk;
  rowCount: number;
  byteSize: number;
  fetchedAt: number; // epoch ms
  visibilityTimeoutSeconds: number | null;
}

export type Page = TabularPage | DocumentPage | KeyValuePage | StreamPage;

export const MAX_CELL_BYTES = 64 * 1024;
export const MAX_PAGE_SIZE = 10_000;
/** Per-document-body truncation budget for a multi-row document page (P8's D1/D6). */
export const DOCUMENT_TRUNCATE_BYTES = MAX_CELL_BYTES;
/** Per-document-body budget for a single explicitly-requested document ("show all", P8's D1). */
export const DOCUMENT_TRUNCATE_BYTES_SINGLE = MAX_CELL_BYTES * 64;

/** P33: the ceiling on an object body the app fetches, decodes and renders **at all**. Equal to
 *  DOCUMENT_TRUNCATE_BYTES_SINGLE by construction, not by coincidence: a body that could only be
 *  shown truncated is a body whose remainder was transferred for nothing, now that Download
 *  hands over the whole file instead. Above this, nothing is fetched and no Body row exists. */
export const OBJECT_BODY_PREVIEW_BYTES = DOCUMENT_TRUNCATE_BYTES_SINGLE; // 4 MB

/** P33: the ceiling on an object body the app will let the user edit and write back. Lower than
 *  the render ceiling because editing is a different cost class — a mutable CodeMirror buffer,
 *  a full re-encode and a PutObject of the result — and because a bad write is not undoable in
 *  an unversioned bucket. Sixteen cell budgets: far above a DB cell (a 200 KB JSON export is a
 *  normal thing to fix by hand), far below a document-sized page. */
export const OBJECT_BODY_EDIT_BYTES = MAX_CELL_BYTES * 16; // 1 MB

/** P33: AWS's hard limit for a single PutObject. Above it an upload needs multipart, which this
 *  phase does not implement (D12) — the adapter refuses with a message that says so. */
export const OBJECT_UPLOAD_MAX_BYTES = 5 * 1024 * 1024 * 1024; // 5 GiB

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

// P2 R2 (task #99): the raw UTF-8 byte length of row i's value, straight from the offsets this
// chunk already carries — for a caller that only wants a byte count (a "1.2 KB" badge), not the
// decoded text. Equal to `new TextEncoder().encode(cellText(chunk, row, decoder)).length` for any
// valid UTF-8 payload (decode-then-reencode round-trips exact byte length), without the decode and
// the redundant reencode a naive caller would otherwise do to get there.
export function cellByteLength(chunk: TextColumnChunk, row: number): number {
  return chunk.offsets[row + 1] - chunk.offsets[row];
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

/** P5 C1/F8: every TextColumnChunk a page carries, regardless of kind — one page-kind-agnostic
 *  way to enumerate them, for the retention probe's own "distinct retained frame buffers" figure
 *  (main.ts's `__kiraRetention`) and for `frame.ts`'s per-page buffer copy (C7). */
export function pageChunks(page: Page): TextColumnChunk[] {
  switch (page.kind) {
    case 'tabular':
      return page.chunks;
    case 'document':
      return [page.ids, page.bodies];
    case 'keyvalue':
      return [page.fields, page.values];
    case 'stream':
      return [page.keys, page.headers, page.attrs, page.timestamps, page.bodies];
  }
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
  appendValue(
    value: string | null,
    row: number,
    encoder: TextEncoder,
    maxBytes: number = MAX_CELL_BYTES,
  ): boolean {
    if (value === null) {
      this.isNullRow.push(true);
      this.rowStart.push(this.used);
      return false;
    }
    this.isNullRow.push(false);
    let bytes = encoder.encode(value);
    let truncated = false;
    if (bytes.length > maxBytes) {
      bytes = truncateUtf8ToBoundary(bytes, maxBytes);
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

/** Mirrors `createTabularPageBuilder`, fixed to the two semantic columns `DocumentPage` uses. */
export interface DocumentPageBuilder {
  /** `id`/`body` are each pre-serialized EJSON text (caller owns EJSON.stringify). */
  push(id: string, body: string): void;
  finish(position: PagePosition): DocumentPage;
}

export function createDocumentPageBuilder(opts?: { singleRow?: boolean }): DocumentPageBuilder {
  const maxBytes = opts?.singleRow ? DOCUMENT_TRUNCATE_BYTES_SINGLE : DOCUMENT_TRUNCATE_BYTES;
  const idScratch = new ColumnScratch();
  const bodyScratch = new ColumnScratch();
  const encoder = new TextEncoder();
  let rowCount = 0;

  return {
    push(id, body) {
      const row = rowCount;
      idScratch.appendValue(id, row, encoder, maxBytes);
      bodyScratch.appendValue(body, row, encoder, maxBytes);
      rowCount++;
    },
    finish(position) {
      const ids = idScratch.finish(rowCount, false);
      const bodies = bodyScratch.finish(rowCount, false);
      const page: DocumentPage = {
        kind: 'document',
        position,
        ids,
        bodies,
        rowCount,
        byteSize: 0,
        fetchedAt: Date.now(),
      };
      page.byteSize = chunkByteSize(ids) + chunkByteSize(bodies);
      return page;
    },
  };
}

/** Mirrors `createDocumentPageBuilder`, fixed to the two semantic columns `KeyValuePage` uses. */
export interface KeyValuePageBuilder {
  push(field: string, value: string): void;
  finish(position: PagePosition): KeyValuePage;
}

export function createKeyValuePageBuilder(opts: {
  redisType: KeyValuePage['redisType'];
  ttlMs: number | null;
  memoryBytes: number | null;
  // Mirrors createDocumentPageBuilder's own singleRow — DOCUMENT_TRUNCATE_BYTES_SINGLE's "a
  // bigger budget when this is the one thing being fetched directly" reasoning applies just as
  // well to an s3 object's Body field (P17) as it does to a document; every redis type keeps the
  // plain MAX_CELL_BYTES default since none of them have a single dominant large-value field.
  singleRow?: boolean;
}): KeyValuePageBuilder {
  const valueMaxBytes = opts.singleRow ? DOCUMENT_TRUNCATE_BYTES_SINGLE : MAX_CELL_BYTES;
  const fieldScratch = new ColumnScratch();
  const valueScratch = new ColumnScratch();
  const encoder = new TextEncoder();
  let rowCount = 0;

  return {
    push(field, value) {
      const row = rowCount;
      fieldScratch.appendValue(field, row, encoder);
      valueScratch.appendValue(value, row, encoder, valueMaxBytes);
      rowCount++;
    },
    finish(position) {
      const fields = fieldScratch.finish(rowCount, false);
      const values = valueScratch.finish(rowCount, false);
      const page: KeyValuePage = {
        kind: 'keyvalue',
        position,
        redisType: opts.redisType,
        ttlMs: opts.ttlMs,
        memoryBytes: opts.memoryBytes,
        fields,
        values,
        rowCount,
        byteSize: 0,
        fetchedAt: Date.now(),
      };
      page.byteSize = chunkByteSize(fields) + chunkByteSize(values);
      return page;
    },
  };
}

/** Mirrors `createKeyValuePageBuilder`, fixed to the five semantic columns `StreamPage` uses. */
export interface StreamPageBuilder {
  push(row: {
    key: string | null;
    headers: string;
    attrs: string;
    timestamp: string | null;
    body: string;
  }): void;
  finish(position: PagePosition): StreamPage;
}

export function createStreamPageBuilder(opts: {
  visibilityTimeoutSeconds: number | null;
}): StreamPageBuilder {
  const keyScratch = new ColumnScratch();
  const headerScratch = new ColumnScratch();
  const attrScratch = new ColumnScratch();
  const timestampScratch = new ColumnScratch();
  const bodyScratch = new ColumnScratch();
  const encoder = new TextEncoder();
  let rowCount = 0;

  return {
    push(row) {
      const i = rowCount;
      keyScratch.appendValue(row.key, i, encoder);
      headerScratch.appendValue(row.headers, i, encoder);
      attrScratch.appendValue(row.attrs, i, encoder);
      timestampScratch.appendValue(row.timestamp, i, encoder);
      bodyScratch.appendValue(row.body, i, encoder);
      rowCount++;
    },
    finish(position) {
      const keys = keyScratch.finish(rowCount, false);
      const headers = headerScratch.finish(rowCount, false);
      const attrs = attrScratch.finish(rowCount, false);
      const timestamps = timestampScratch.finish(rowCount, false);
      const bodies = bodyScratch.finish(rowCount, false);
      const page: StreamPage = {
        kind: 'stream',
        position,
        keys,
        headers,
        attrs,
        timestamps,
        bodies,
        rowCount,
        byteSize: 0,
        fetchedAt: Date.now(),
        visibilityTimeoutSeconds: opts.visibilityTimeoutSeconds,
      };
      page.byteSize =
        chunkByteSize(keys) +
        chunkByteSize(headers) +
        chunkByteSize(attrs) +
        chunkByteSize(timestamps) +
        chunkByteSize(bodies);
      return page;
    },
  };
}

/**
 * The envelope-only schema (§4a): running Zod over every cell of a 600 000-cell page would
 * cost more than the query. Pair with `assertPageStructure` for the typed-array invariants.
 */
export const tabularPageEnvelopeSchema = z.object({
  kind: z.literal('tabular'),
  columns: z.array(columnDescriptorSchema),
  rowCount: z.number().int().min(0),
  position: pagePositionSchema,
  truncatedCells: z.number().int().min(0),
  byteSize: z.number().int().min(0),
  fetchedAt: z.number(),
});

export const documentPageEnvelopeSchema = z.object({
  kind: z.literal('document'),
  rowCount: z.number().int().min(0),
  position: pagePositionSchema,
  byteSize: z.number().int().min(0),
  fetchedAt: z.number(),
});

export const keyValuePageEnvelopeSchema = z.object({
  kind: z.literal('keyvalue'),
  redisType: z.enum(['string', 'hash', 'list', 'set', 'zset', 'stream', 'object']),
  ttlMs: z.number().int().nullable(),
  memoryBytes: z.number().int().nullable(),
  rowCount: z.number().int().min(0),
  position: pagePositionSchema,
  byteSize: z.number().int().min(0),
  fetchedAt: z.number(),
});

export const streamPageEnvelopeSchema = z.object({
  kind: z.literal('stream'),
  rowCount: z.number().int().min(0),
  position: pagePositionSchema,
  byteSize: z.number().int().min(0),
  fetchedAt: z.number(),
  visibilityTimeoutSeconds: z.number().int().nullable(),
});

export const pageEnvelopeSchema = z.discriminatedUnion('kind', [
  tabularPageEnvelopeSchema,
  documentPageEnvelopeSchema,
  keyValuePageEnvelopeSchema,
  streamPageEnvelopeSchema,
]);

function assertChunkStructure(chunk: TextColumnChunk, rowCount: number, label: string): void {
  if (!(chunk.data instanceof Uint8Array)) throw new Error(`${label}.data is not a Uint8Array`);
  if (!(chunk.offsets instanceof Uint32Array)) {
    throw new Error(`${label}.offsets is not a Uint32Array`);
  }
  if (!(chunk.nulls instanceof Uint8Array)) throw new Error(`${label}.nulls is not a Uint8Array`);
  if (!(chunk.truncated instanceof Uint32Array)) {
    throw new Error(`${label}.truncated is not a Uint32Array`);
  }
  if (chunk.offsets.length !== rowCount + 1) {
    throw new Error(
      `${label}.offsets has ${chunk.offsets.length} entries, expected ${rowCount + 1}`,
    );
  }
  if (chunk.nulls.length !== bitsetBytes(rowCount)) {
    throw new Error(
      `${label}.nulls has ${chunk.nulls.length} bytes, expected ${bitsetBytes(rowCount)}`,
    );
  }
}

/** Throws when a page's typed arrays disagree with its own envelope fields. */
export function assertPageStructure(page: Page): void {
  if (page.kind === 'tabular') {
    if (page.chunks.length !== page.columns.length) {
      throw new Error(`page has ${page.chunks.length} chunks for ${page.columns.length} columns`);
    }
    for (const chunk of page.chunks) assertChunkStructure(chunk, page.rowCount, 'chunk');
    return;
  }
  if (page.kind === 'document') {
    assertChunkStructure(page.ids, page.rowCount, 'ids');
    assertChunkStructure(page.bodies, page.rowCount, 'bodies');
    return;
  }
  if (page.kind === 'keyvalue') {
    assertChunkStructure(page.fields, page.rowCount, 'fields');
    assertChunkStructure(page.values, page.rowCount, 'values');
    return;
  }
  assertChunkStructure(page.keys, page.rowCount, 'keys');
  assertChunkStructure(page.headers, page.rowCount, 'headers');
  assertChunkStructure(page.attrs, page.rowCount, 'attrs');
  assertChunkStructure(page.timestamps, page.rowCount, 'timestamps');
  assertChunkStructure(page.bodies, page.rowCount, 'bodies');
}
