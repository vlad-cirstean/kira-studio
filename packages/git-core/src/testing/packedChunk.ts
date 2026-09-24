import type { DecorationRef } from '../model/commit.ts';
import type { PackedCommitChunk } from '../store/commitStore.ts';

/** A fixture-only sample instant — `packages/git-ui`'s own `dateFormat.ts` renders it as
 *  `"2024-12-30 22:48"`, the widest absolute-date rendering that module's own tests exercise. Kept
 *  as a literal here (not imported: not exported there, and this file lives outside
 *  `packages/git-ui`) so every fixture built from it agrees on one instant. */
export const WIDEST_SAMPLE_TIMESTAMP = Date.UTC(2024, 11, 30, 22, 48) / 1000;

export function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

export interface PackedChunkRow {
  readonly sha: string;
  readonly subject: string;
  /** Parent shas, same 40-hex-char form as `sha` — omitted or empty for a root commit. */
  readonly parents?: readonly string[];
  /** This row's own ref badges, if any. */
  readonly decoration?: readonly DecorationRef[];
}

export interface BuildPackedChunkOptions {
  /** The chunk's own `from` row (global store row of `rows[0]`) — default `0`. */
  readonly from?: number;
  /** Author/committer time for every row — default `WIDEST_SAMPLE_TIMESTAMP`. */
  readonly timestamp?: number;
  /** Identity dictionary — default one shared author/committer identity. Pass `[]` with a
   *  `dictionaryBase` matching an earlier chunk's own dictionary size for a second chunk in the
   *  same stream that reuses it without re-declaring it (`CommitStore.appendPacked`'s
   *  delta-encoding contract: `dictionary` holds only strings interned since `dictionaryBase`). */
  readonly dictionary?: readonly string[];
  readonly dictionaryBase?: number;
}

/**
 * Builds a `PackedCommitChunk` test fixture from `rows` — the VS Code interaction/layout suites'
 * and Space's UI suite's own shared shape (P107 I2-27), each of which previously hand-rolled its
 * own copy of this packing logic (a single-row root commit, or a whole multi-branch chunk whose
 * every parent link resolves within it). A row with no `parents` is a root commit; a later row
 * naming an earlier row's own `sha` as a parent resolves within this same chunk, same as
 * `CommitStore.appendPacked`'s own pending-parent pass does for a real one.
 *
 * Returns `packages/git-core`'s own `PackedCommitChunk` (B3: this package may not import
 * `@kira/git-ipc`'s copy) — structurally identical, so it drops straight into any caller's own
 * `PackedCommitChunk`-typed slot. This repo carries no `wireConformance.test.ts`
 * (`@kira/git-ipc`'s own `contract.ts` doc comment says why) — the two shapes are kept in step
 * by hand instead.
 */
export function buildPackedChunk(
  rows: readonly PackedChunkRow[],
  options: BuildPackedChunkOptions = {},
): PackedCommitChunk {
  const from = options.from ?? 0;
  const timestamp = options.timestamp ?? WIDEST_SAMPLE_TIMESTAMP;
  const dictionary = options.dictionary ?? ['Fake Author', 'fake@example.com'];
  const dictionaryBase = options.dictionaryBase ?? 0;
  const rowCount = rows.length;

  const shaBytes = Buffer.concat(rows.map((row) => Buffer.from(row.sha, 'hex')));

  const parentOffsets: number[] = [0];
  const parentShaBuffers: Buffer[] = [];
  for (const row of rows) {
    for (const parentSha of row.parents ?? []) {
      parentShaBuffers.push(Buffer.from(parentSha, 'hex'));
    }
    parentOffsets.push(parentShaBuffers.length);
  }
  const parentShaBytes = Buffer.concat(parentShaBuffers);

  const identityIds = new Uint32Array(rowCount * 4);
  const times = new Uint32Array(rowCount * 2);
  for (let i = 0; i < rowCount; i++) {
    identityIds.set([0, 1, 0, 1], i * 4);
    times.set([timestamp, timestamp], i * 2);
  }

  const subjectBuffers = rows.map((row) => Buffer.from(row.subject, 'utf8'));
  const subjectBytes = Buffer.concat(subjectBuffers);
  const subjectOffsets = new Uint32Array(rowCount + 1);
  let cursor = 0;
  for (let i = 0; i < rowCount; i++) {
    subjectOffsets[i] = cursor;
    cursor += subjectBuffers[i].byteLength;
  }
  subjectOffsets[rowCount] = cursor;

  const decorations: (readonly [number, readonly DecorationRef[]])[] = [];
  rows.forEach((row, i) => {
    if (row.decoration && row.decoration.length > 0) decorations.push([i, row.decoration]);
  });

  return {
    from,
    to: from + rowCount,
    shaWidthBytes: 20,
    shas: toArrayBuffer(shaBytes),
    parentOffsets: Uint32Array.from(parentOffsets).buffer,
    parentShas: toArrayBuffer(parentShaBytes),
    identityIds: identityIds.buffer,
    times: times.buffer,
    subjectBytes: toArrayBuffer(subjectBytes),
    subjectOffsets: subjectOffsets.buffer,
    dictionaryBase,
    dictionary: [...dictionary],
    decorations,
  };
}
