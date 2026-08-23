/**
 * §5.5's second memory rule — "shas are stored as 20-byte binary in a single flat
 * `Uint8Array`, not as 40-char hex strings (which cost ~120 bytes each in V8)" — plus the
 * lookup that rule quietly makes hard.
 *
 * A `Map<string, number>` keyed on 40-char hex would cost roughly 100k * (a ~120-byte string +
 * a ~50-byte map entry) ~= 17 MB, which is more than everything else in the store combined and
 * is exactly the representation this rule exists to forbid — storing shas as bytes and then
 * indexing them by string would follow the letter of §5.5 and violate its point. So the index
 * here is an open-addressed hash table over the binary shas themselves: at 100k commits that
 * is roughly a 1 MB table plus 2 MB of shas.
 */
import { assert } from "../util/assert.ts";

const HEX_PATTERN = /^[0-9a-fA-F]+$/;

/** Exported for `commitStore.ts`'s wire packing (W3): a pending parent is tracked there as hex,
 *  and a packed chunk's parent shas travel as raw bytes, so both directions need this pair. */
export function hexToBytes(hex: string, widthBytes: number): Uint8Array {
  assert(
    hex.length === widthBytes * 2,
    `ShaTable: expected a ${widthBytes * 2}-character hex sha, got ${hex.length} characters ` +
      `(${JSON.stringify(hex)})`,
  );
  assert(HEX_PATTERN.test(hex), `ShaTable: not a valid hex sha: ${JSON.stringify(hex)}`);
  const bytes = new Uint8Array(widthBytes);
  for (let i = 0; i < widthBytes; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

const HEX_CHARS = "0123456789abcdef";

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] as number;
    out += HEX_CHARS[byte >> 4];
    out += HEX_CHARS[byte & 0x0f];
  }
  return out;
}

/** git object ids are uniformly distributed, so the leading 4 bytes read little-endian are as
 *  good a hash as anything we could compute, and cost nothing extra to obtain. */
function hashFirstFourBytes(bytes: Uint8Array): number {
  const b0 = bytes[0] as number;
  const b1 = bytes[1] as number;
  const b2 = bytes[2] as number;
  const b3 = bytes[3] as number;
  return (((b3 << 24) | (b2 << 16) | (b1 << 8) | b0) >>> 0) >>> 0;
}

/** Compares `sha` (a full `widthBytes`-length array or view, always indexed from 0) against
 *  `widthBytes` bytes of `rows` starting at `rowStart`. */
function shaEqualsRow(
  sha: Uint8Array,
  rows: Uint8Array,
  rowStart: number,
  widthBytes: number,
): boolean {
  for (let i = 0; i < widthBytes; i++) {
    if (sha[i] !== rows[rowStart + i]) return false;
  }
  return true;
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

const EMPTY_SLOT = -1;
const DEFAULT_INITIAL_CAPACITY = 1024;
const MAX_LOAD_FACTOR = 0.5;

export interface ShaTableOptions {
  /** 20 for SHA-1 (the common case), 32 for a `--object-format=sha256` repository. Detected
   *  automatically from the first hex string appended if not given. */
  readonly widthBytes?: 20 | 32;
  /** Row capacity to preallocate for. Grows by doubling regardless. */
  readonly initialCapacity?: number;
}

/**
 * 20-byte (or 32-byte, for sha256) binary shas in one flat, growable `Uint8Array`, indexed by
 * an open-addressed hash table so a parent sha or a ref's object id can be resolved to a row
 * without ever materializing a 40-char string as a map key.
 */
export class ShaTable {
  #widthBytes: number | undefined;
  readonly #requestedWidthBytes: 20 | 32 | undefined;
  #bytes = new Uint8Array(0);
  #count = 0;
  #slots = new Int32Array(0); // row index per slot, EMPTY_SLOT when unoccupied
  #slotCapacity = 0;
  readonly #initialRowCapacity: number;

  constructor(opts: ShaTableOptions = {}) {
    this.#requestedWidthBytes = opts.widthBytes;
    this.#widthBytes = opts.widthBytes;
    this.#initialRowCapacity = opts.initialCapacity ?? DEFAULT_INITIAL_CAPACITY;
    this.#allocateSlots(nextPowerOfTwo(Math.max(16, this.#initialRowCapacity * 2)));
  }

  get count(): number {
    return this.#count;
  }

  get widthBytes(): number {
    assert(this.#widthBytes !== undefined, "ShaTable.widthBytes: nothing appended yet");
    return this.#widthBytes;
  }

  /** Bytes retained by the sha buffer and the hash-table index together. */
  get byteLength(): number {
    return this.#bytes.byteLength + this.#slots.byteLength;
  }

  clear(): void {
    this.#widthBytes = this.#requestedWidthBytes;
    this.#bytes = new Uint8Array(0);
    this.#count = 0;
    this.#allocateSlots(nextPowerOfTwo(Math.max(16, this.#initialRowCapacity * 2)));
  }

  append(hex: string): number {
    if (this.#widthBytes === undefined) {
      const detected = hex.length / 2;
      assert(
        detected === 20 || detected === 32,
        `ShaTable: unrecognised sha length ${hex.length} (expected 40 or 64 hex characters)`,
      );
      this.#widthBytes = this.#requestedWidthBytes ?? (detected as 20 | 32);
    }
    return this.appendBytes(hexToBytes(hex, this.#widthBytes));
  }

  /** As `append`, but from raw bytes rather than hex — the wire-format path (W3), where a
   *  packed chunk's shas already arrive as binary and re-stringifying them to hex first would
   *  be pure waste. Width is detected from `bytes.length` the same way `append` detects it from
   *  hex length. */
  appendBytes(bytes: Uint8Array): number {
    if (this.#widthBytes === undefined) {
      assert(
        bytes.length === 20 || bytes.length === 32,
        `ShaTable: unrecognised sha byte width ${bytes.length} (expected 20 or 32)`,
      );
      this.#widthBytes = this.#requestedWidthBytes ?? (bytes.length as 20 | 32);
    }
    const width = this.#widthBytes;
    assert(
      bytes.length === width,
      `ShaTable.appendBytes: expected ${width}-byte shas, got ${bytes.length}`,
    );

    const row = this.#count;
    const requiredBytes = (row + 1) * width;
    if (requiredBytes > this.#bytes.length) this.#growRows(width);
    this.#bytes.set(bytes, row * width);
    this.#count++;

    this.#insertIntoIndex(row, bytes);
    return row;
  }

  hexAt(row: number): string {
    return bytesToHex(this.#rowBytes(row));
  }

  shortHexAt(row: number, chars: number): string {
    return this.hexAt(row).slice(0, chars);
  }

  /** A subarray view into the flat buffer — never a copy. */
  bytesAt(row: number): Uint8Array {
    return this.#rowBytes(row);
  }

  /** A subarray view over rows `[from, to)` — never a copy; the wire-packing path (W3) copies
   *  it into a fresh, transferable buffer itself. */
  rangeView(from: number, to: number): Uint8Array {
    assert(
      from >= 0 && to <= this.#count && from <= to,
      `ShaTable.rangeView(${from}, ${to}): out of range (${this.#count} entries)`,
    );
    const width = this.widthBytes;
    return this.#bytes.subarray(from * width, to * width);
  }

  rowOfHex(hex: string): number {
    if (this.#widthBytes === undefined) return EMPTY_SLOT;
    const bytes = hexToBytes(hex, this.#widthBytes);
    return this.rowOfBytes(bytes);
  }

  rowOfBytes(sha: Uint8Array): number {
    if (this.#widthBytes === undefined || this.#count === 0) return EMPTY_SLOT;
    return this.#findSlot(sha).row;
  }

  #rowBytes(row: number): Uint8Array {
    assert(
      row >= 0 && row < this.#count,
      `ShaTable: row ${row} out of range (${this.#count} entries)`,
    );
    const width = this.widthBytes;
    return this.#bytes.subarray(row * width, row * width + width);
  }

  #growRows(width: number): void {
    const currentRows = this.#bytes.length / width || 0;
    const newRowCapacity = Math.max(
      this.#initialRowCapacity,
      currentRows === 0 ? 1 : currentRows * 2,
    );
    const grown = new Uint8Array(newRowCapacity * width);
    grown.set(this.#bytes);
    this.#bytes = grown;
  }

  #allocateSlots(capacity: number): void {
    this.#slotCapacity = capacity;
    this.#slots = new Int32Array(capacity).fill(EMPTY_SLOT);
  }

  /** Linear probing from the hash of `sha`. Returns the slot that already holds this sha (row
   *  set) or the first empty slot it would occupy (row === EMPTY_SLOT). */
  #findSlot(sha: Uint8Array): { readonly slotIndex: number; readonly row: number } {
    const width = this.widthBytes;
    const mask = this.#slotCapacity - 1;
    let slotIndex = hashFirstFourBytes(sha) & mask;
    for (;;) {
      const row = this.#slots[slotIndex] as number;
      if (row === EMPTY_SLOT) return { slotIndex, row: EMPTY_SLOT };
      if (shaEqualsRow(sha, this.#bytes, row * width, width)) return { slotIndex, row };
      slotIndex = (slotIndex + 1) & mask;
    }
  }

  #insertIntoIndex(row: number, sha: Uint8Array): void {
    if ((this.#count + 1) / this.#slotCapacity > MAX_LOAD_FACTOR) this.#rehash();
    const { slotIndex } = this.#findSlot(sha);
    this.#slots[slotIndex] = row;
  }

  #rehash(): void {
    const width = this.widthBytes;
    const newCapacity = this.#slotCapacity * 2;
    const oldSlots = this.#slots;
    this.#allocateSlots(newCapacity);
    for (let i = 0; i < oldSlots.length; i++) {
      const row = oldSlots[i] as number;
      if (row === EMPTY_SLOT) continue;
      const view = this.#bytes.subarray(row * width, row * width + width);
      const { slotIndex } = this.#findSlot(view);
      this.#slots[slotIndex] = row;
    }
  }
}
