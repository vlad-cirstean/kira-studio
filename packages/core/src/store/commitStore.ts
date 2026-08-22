/**
 * §5.5's first memory rule: "commits are stored column-wise in typed arrays, not row-wise as
 * objects ... a commit 'object' is materialized on demand for the <=60 rows on screen and the
 * one selected commit, then discarded." This is the store that rule describes, built on
 * `ShaTable` (W3) and `StringInterner`/`SubjectBuffer` (W2).
 */
import type { CommitIdentity, CommitRecord, DecorationRef } from "../model/commit.ts";
import { assert } from "../util/assert.ts";
import { StringInterner, SubjectBuffer } from "./intern.ts";
import { ShaTable } from "./shaTable.ts";

const UINT32_MAX = 0xffffffff;

/** Clamps a commit timestamp into `Uint32Array` range (1970 .. ~2106). Clock-skewed or
 *  imported histories do produce dates outside that range; clamping costs one comparison and
 *  keeps every timestamp column a `Uint32Array` instead of an 8-byte `Float64Array` for every
 *  repository to accommodate the rare one. `stats()` reports how many rows this touched. */
function clampTimestamp(value: number): { readonly clamped: number; readonly wasClamped: boolean } {
  if (!Number.isFinite(value) || value < 0) return { clamped: 0, wasClamped: value !== 0 };
  if (value > UINT32_MAX) return { clamped: UINT32_MAX, wasClamped: true };
  const floored = Math.floor(value);
  return { clamped: floored, wasClamped: floored !== value };
}

type TypedIntArray = Uint32Array | Int32Array;

/** A growable column backed by a typed array, doubling capacity on overflow like
 *  `intern.ts`'s buffers. Shared by every fixed-width column this store maintains. */
class GrowableColumn<T extends TypedIntArray> {
  #array: T;
  #length = 0;
  readonly #Ctor: new (length: number) => T;

  constructor(Ctor: new (length: number) => T, initialCapacity = 1024) {
    this.#Ctor = Ctor;
    this.#array = new Ctor(Math.max(1, initialCapacity));
  }

  push(value: number): number {
    if (this.#length >= this.#array.length) this.#grow();
    const index = this.#length;
    this.#array[index] = value;
    this.#length++;
    return index;
  }

  get(index: number): number {
    assert(index >= 0 && index < this.#length, `GrowableColumn.get(${index}): out of range`);
    return this.#array[index] as number;
  }

  set(index: number, value: number): void {
    assert(index >= 0 && index < this.#length, `GrowableColumn.set(${index}): out of range`);
    this.#array[index] = value;
  }

  get length(): number {
    return this.#length;
  }

  /** A view over exactly the appended entries — never a copy. */
  view(): T {
    return this.#array.subarray(0, this.#length) as T;
  }

  get byteLength(): number {
    return this.#array.byteLength;
  }

  clear(): void {
    this.#array = new this.#Ctor(1);
    this.#length = 0;
  }

  #grow(): void {
    const newCapacity = Math.max(1, this.#array.length * 2);
    const grown = new this.#Ctor(newCapacity);
    grown.set(this.#array);
    this.#array = grown;
  }
}

export interface AppendResult {
  readonly from: number;
  readonly to: number;
  /** Slots in the parent column that changed from unresolved to a real row because this batch
   *  supplied the parent — feeds the layout's incremental patch pass (W9). */
  readonly resolvedParentSlots: Uint32Array;
}

export interface CommitStoreStats {
  readonly rowCount: number;
  readonly shaTableBytes: number;
  /** The six identity/time columns plus the parent CSR pair. */
  readonly columnBytes: number;
  readonly subjectBufferBytes: number;
  readonly internedStringBytes: number;
  readonly decorationEntryCount: number;
  readonly pendingParentCount: number;
  readonly clampedTimestampCount: number;
  readonly totalBytes: number;
}

/** Not exported — parents unresolved at read time are surfaced as `-1` in `parentsOf()`'s
 *  `Int32Array`, per `core/graph/types.ts` (W5)'s `-1`-means-not-loaded convention there. */
const UNRESOLVED_PARENT_ROW = -1;

export class CommitStore {
  readonly #shas = new ShaTable();
  readonly #interner = new StringInterner();
  readonly #subjects = new SubjectBuffer();

  readonly #authorName = new GrowableColumn(Uint32Array);
  readonly #authorEmail = new GrowableColumn(Uint32Array);
  readonly #authorTime = new GrowableColumn(Uint32Array);
  readonly #committerName = new GrowableColumn(Uint32Array);
  readonly #committerEmail = new GrowableColumn(Uint32Array);
  readonly #committerTime = new GrowableColumn(Uint32Array);

  readonly #parentOffsets = new GrowableColumn(Uint32Array);
  readonly #parentRows = new GrowableColumn(Int32Array);

  readonly #decorations = new Map<number, readonly DecorationRef[]>();
  /** Parent slots not yet resolvable to a row, keyed by slot index, value the parent's hex sha
   *  — bounded by the walk's open frontier (typically well under a hundred), never by row
   *  count. Also what lets `commitAt()` reconstruct an unresolved parent's sha exactly, since
   *  `parentsOf()`'s `-1` alone would otherwise lose it. */
  readonly #pendingParents = new Map<number, string>();

  #rowCount = 0;
  #clampedTimestampCount = 0;

  constructor() {
    this.#parentOffsets.push(0);
  }

  get rowCount(): number {
    return this.#rowCount;
  }

  append(record: CommitRecord): number {
    return this.appendPage([record]).from;
  }

  appendPage(records: Iterable<CommitRecord>): AppendResult {
    const from = this.#rowCount;
    for (const record of records) this.#appendOne(record);
    const to = this.#rowCount;
    const resolvedParentSlots = Uint32Array.from(this.#resolvePendingParents());
    return { from, to, resolvedParentSlots };
  }

  #appendOne(record: CommitRecord): void {
    const row = this.#rowCount;
    const shaRow = this.#shas.append(record.sha);
    assert(
      shaRow === row,
      `CommitStore: sha table row ${shaRow} does not match store row ${row} — ` +
        `records must be appended in row order`,
    );

    this.#authorName.push(this.#interner.intern(record.author.name));
    this.#authorEmail.push(this.#interner.intern(record.author.email));
    this.#authorTime.push(this.#pushClamped(record.author.timestamp));
    this.#committerName.push(this.#interner.intern(record.committer.name));
    this.#committerEmail.push(this.#interner.intern(record.committer.email));
    this.#committerTime.push(this.#pushClamped(record.committer.timestamp));

    const subjectRow = this.#subjects.append(record.subject);
    assert(subjectRow === row, "unreachable: subjects appended in the same order as rows");

    if (record.decoration.length > 0) this.#decorations.set(row, record.decoration);

    for (const parentSha of record.parents) {
      const parentRow = this.#shas.rowOfHex(parentSha);
      const slot = this.#parentRows.push(parentRow === -1 ? UNRESOLVED_PARENT_ROW : parentRow);
      if (parentRow === -1) this.#pendingParents.set(slot, parentSha);
    }
    this.#parentOffsets.push(this.#parentRows.length);
    this.#rowCount++;
  }

  #pushClamped(timestamp: number): number {
    const { clamped, wasClamped } = clampTimestamp(timestamp);
    if (wasClamped) this.#clampedTimestampCount++;
    return clamped;
  }

  #resolvePendingParents(): number[] {
    if (this.#pendingParents.size === 0) return [];
    const resolved: number[] = [];
    for (const [slot, parentSha] of this.#pendingParents) {
      const parentRow = this.#shas.rowOfHex(parentSha);
      if (parentRow === -1) continue;
      this.#parentRows.set(slot, parentRow);
      resolved.push(slot);
    }
    for (const slot of resolved) this.#pendingParents.delete(slot);
    return resolved;
  }

  rowOfSha(hex: string): number {
    return this.#shas.rowOfHex(hex);
  }

  shaAt(row: number): string {
    return this.#shas.hexAt(row);
  }

  shortShaAt(row: number, chars = 7): string {
    return this.#shas.shortHexAt(row, chars);
  }

  subjectAt(row: number): string {
    return this.#subjects.at(row);
  }

  authorAt(row: number): CommitIdentity {
    return {
      name: this.#interner.get(this.#authorName.get(row)),
      email: this.#interner.get(this.#authorEmail.get(row)),
      timestamp: this.#authorTime.get(row),
    };
  }

  committerAt(row: number): CommitIdentity {
    return {
      name: this.#interner.get(this.#committerName.get(row)),
      email: this.#interner.get(this.#committerEmail.get(row)),
      timestamp: this.#committerTime.get(row),
    };
  }

  /** A view into the parent column: row indices, or -1 for a parent not (yet) loaded. */
  parentsOf(row: number): Int32Array {
    assert(row >= 0 && row < this.#rowCount, `CommitStore.parentsOf(${row}): out of range`);
    const offsets = this.#parentOffsets;
    const start = offsets.get(row);
    const end = offsets.get(row + 1);
    return this.#parentRows.view().subarray(start, end);
  }

  decorationAt(row: number): readonly DecorationRef[] {
    return this.#decorations.get(row) ?? [];
  }

  /** The <=60-rows-on-screen path (§5.5): allocates one object, retains nothing. */
  commitAt(row: number): CommitRecord {
    const parentRows = this.parentsOf(row);
    const offsets = this.#parentOffsets;
    const start = offsets.get(row);
    const parents = Array.from(parentRows, (parentRow, i) => {
      if (parentRow !== UNRESOLVED_PARENT_ROW) return this.shaAt(parentRow);
      const hex = this.#pendingParents.get(start + i);
      assert(hex !== undefined, "unreachable: unresolved parent slot missing from pending map");
      return hex;
    });
    return {
      sha: this.shaAt(row),
      parents,
      author: this.authorAt(row),
      committer: this.committerAt(row),
      subject: this.subjectAt(row),
      decoration: this.decorationAt(row),
    };
  }

  stats(): CommitStoreStats {
    const columnBytes =
      this.#authorName.byteLength +
      this.#authorEmail.byteLength +
      this.#authorTime.byteLength +
      this.#committerName.byteLength +
      this.#committerEmail.byteLength +
      this.#committerTime.byteLength +
      this.#parentOffsets.byteLength +
      this.#parentRows.byteLength;
    const shaTableBytes = this.#shas.byteLength;
    const subjectBufferBytes = this.#subjects.byteLength;
    const internedStringBytes = this.#interner.byteLength;
    return {
      rowCount: this.#rowCount,
      shaTableBytes,
      columnBytes,
      subjectBufferBytes,
      internedStringBytes,
      decorationEntryCount: this.#decorations.size,
      pendingParentCount: this.#pendingParents.size,
      clampedTimestampCount: this.#clampedTimestampCount,
      totalBytes: shaTableBytes + columnBytes + subjectBufferBytes + internedStringBytes,
    };
  }

  clear(): void {
    this.#shas.clear();
    this.#decorations.clear();
    this.#pendingParents.clear();
    this.#rowCount = 0;
    this.#clampedTimestampCount = 0;
    this.#authorName.clear();
    this.#authorEmail.clear();
    this.#authorTime.clear();
    this.#committerName.clear();
    this.#committerEmail.clear();
    this.#committerTime.clear();
    this.#parentOffsets.clear();
    this.#parentRows.clear();
    this.#parentOffsets.push(0);
    this.#interner.clear();
    this.#subjects.clear();
  }
}
