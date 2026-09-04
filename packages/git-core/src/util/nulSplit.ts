/**
 * Incremental, byte-oriented record splitting. `RecordSplitter` is fed chunks as they arrive
 * off a stream and yields complete records, holding a partial record across chunk boundaries
 * — the mechanism every git porcelain/plumbing parser in packages/git is built on, since
 * `-z` output and `%x1f`-separated fields are both "split on a single delimiter byte", just
 * with different bytes and different framing granularity.
 *
 * Bytes in, bytes out. Decoding to a string happens once per field, in the parser that knows
 * what the field means — not here (see packages/git/src/parse/*.ts).
 */

const DEFAULT_MAX_REMAINDER_BYTES = 8 * 1024 * 1024;

export class RemainderOverflowError extends Error {
  constructor(limit: number) {
    super(
      `record splitter remainder exceeded ${limit} bytes without a delimiter — malformed or ` +
        `unexpectedly large output`,
    );
    this.name = 'RemainderOverflowError';
  }
}

export interface RecordSplitterOptions {
  /** The byte value that terminates a record. Defaults to 0x00 (NUL, git's `-z`). */
  readonly delimiter?: number;
  /** Throws rather than growing without bound if no delimiter arrives within this many bytes. */
  readonly maxRemainderBytes?: number;
}

/**
 * Feed chunks via `push`; each call returns the records completed by that chunk. Call
 * `finish()` once the source is exhausted to retrieve a trailing, undelimited fragment (which
 * for well-formed git output is always empty — every record git emits is delimiter-terminated).
 */
export class RecordSplitter {
  readonly #delimiter: number;
  readonly #maxRemainder: number;
  #remainder: Uint8Array[] = [];
  #remainderLength = 0;

  constructor(opts: RecordSplitterOptions = {}) {
    this.#delimiter = opts.delimiter ?? 0x00;
    this.#maxRemainder = opts.maxRemainderBytes ?? DEFAULT_MAX_REMAINDER_BYTES;
  }

  push(chunk: Uint8Array): Uint8Array[] {
    const records: Uint8Array[] = [];
    let start = 0;
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] === this.#delimiter) {
        records.push(this.#take(chunk.subarray(start, i)));
        start = i + 1;
      }
    }
    this.#hold(chunk.subarray(start));
    return records;
  }

  finish(): Uint8Array | undefined {
    if (this.#remainderLength === 0) return undefined;
    return this.#take(new Uint8Array(0));
  }

  #take(finalPiece: Uint8Array): Uint8Array {
    if (this.#remainder.length === 0) return finalPiece;
    const out = new Uint8Array(this.#remainderLength + finalPiece.length);
    let offset = 0;
    for (const piece of this.#remainder) {
      out.set(piece, offset);
      offset += piece.length;
    }
    out.set(finalPiece, offset);
    this.#remainder = [];
    this.#remainderLength = 0;
    return out;
  }

  #hold(piece: Uint8Array): void {
    if (piece.length === 0) return;
    this.#remainderLength += piece.length;
    if (this.#remainderLength > this.#maxRemainder) {
      throw new RemainderOverflowError(this.#maxRemainder);
    }
    this.#remainder.push(piece);
  }
}

/** Streams records out of an async byte source, in order, as they complete. */
export async function* splitRecords(
  source: AsyncIterable<Uint8Array>,
  opts: RecordSplitterOptions = {},
): AsyncGenerator<Uint8Array> {
  const splitter = new RecordSplitter(opts);
  for await (const chunk of source) {
    for (const record of splitter.push(chunk)) yield record;
  }
  const tail = splitter.finish();
  if (tail !== undefined) yield tail;
}

/**
 * Splits an already-complete record into at most `fieldCount` fields on `delimiter`,
 * non-recursively: the last field absorbs everything after the (fieldCount - 1)th delimiter
 * instead of being split further. This is what makes `git log`'s subject field (deliberately
 * placed last in the format string) safe even if it contains a stray delimiter byte — the
 * guarantee is structural, not a hope about the data.
 */
export function splitLimitedFields(
  bytes: Uint8Array,
  delimiter: number,
  fieldCount: number,
): Uint8Array[] {
  const fields: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i < bytes.length && fields.length < fieldCount - 1; i++) {
    if (bytes[i] === delimiter) {
      fields.push(bytes.subarray(start, i));
      start = i + 1;
    }
  }
  fields.push(bytes.subarray(start));
  return fields;
}
