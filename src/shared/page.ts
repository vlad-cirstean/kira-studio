// The wire format for result data (P2 D2–D5). Pages are COLUMNAR: per column one flags byte-array
// plus one typed array (or a UTF-8/bytes blob with an offset index). No row objects ever exist —
// a 5 000×40 page as objects is 200 000 property slots and ~20 MB of heap; as columns it is ~40
// buffers with an exactly-known byte count, which is the only number L2's budget can be honest
// about. Everything here crosses a process boundary but carries megabytes of typed arrays, so it
// is deliberately NOT Zod-validated per page (a Zod parse would defeat the whole point); the
// renderer validates it structurally via `assertTabularPage` (§3.1 of the P2 plan). This is the
// one bounded, documented exception to the Zod-at-every-boundary standing rule.

// Bits in a column's per-row flags byte. Two bits today, six spare — do not repurpose them without
// changing the encoder and every decoder in lockstep.
export const CELL_NULL = 1 << 0;
export const CELL_TRUNCATED = 1 << 1;

// D5: cell payloads are capped here. Grid shows the prefix plus `…`; the full value is P3's cell
// editor, which reads the CELL_TRUNCATED flag.
export const MAX_CELL_BYTES = 64 * 1024;

export type ColumnEncoding = 'f64' | 'i64' | 'bool' | 'utf8' | 'bytes';

export interface PageColumn {
  name: string;
  /** The server's own type name (`int4`, `VARCHAR(255)`, `jsonb`). Header tooltip + alignment. */
  dataType: string;
  encoding: ColumnEncoding;
  /** length === rowCount. CELL_NULL / CELL_TRUNCATED. One byte per row, not a bitmask. */
  flags: Uint8Array;
  /** f64 | i64 | bool — length === rowCount. `bool` uses 0/1 bytes. Absent for utf8/bytes. */
  values?: Float64Array | BigInt64Array | Uint8Array;
  /** utf8 | bytes payload, concatenated. Absent for f64/i64/bool. */
  data?: Uint8Array;
  /** utf8 | bytes — length === rowCount + 1; cell i spans [offsets[i], offsets[i+1]). */
  offsets?: Int32Array;
}

export type PageCursor =
  | { kind: 'offset'; offset: number }
  | { kind: 'keyset'; token: string; direction: 'next' | 'prev' };

/** Canonical string form of a cursor. Used both as the on-the-wire token and as the final component
 *  of the L2 key (§7 calls it `pageToken`). `off:0`, `ks:next:<token>`. */
export function cursorKey(c: PageCursor): string {
  if (c.kind === 'offset') return `off:${c.offset}`;
  return `ks:${c.direction}:${c.token}`;
}

export interface TabularPage {
  kind: 'tabular';
  columns: PageColumn[];
  rowCount: number;
  /** Absolute offset of row 0 when known (always for offset cursors, only when the keyset walk
   *  started from a known offset otherwise). Drives the row-number gutter. */
  offset: number | null;
  nextToken: string | null; // null ⇒ this is the last page
  prevToken: string | null;
  /** Sum of every buffer's byteLength. The *only* number L2 budgets against (§2.2). */
  bytes: number;
  truncatedCells: number;
  elapsedMs: number;
  fromCache: boolean;
}

// `Page` is one arm of §5's discriminated union; P7/P8 widen this type to
// `TabularPage | DocumentPage | KeyValuePage | StreamPage` without touching call sites.
export type Page = TabularPage;
