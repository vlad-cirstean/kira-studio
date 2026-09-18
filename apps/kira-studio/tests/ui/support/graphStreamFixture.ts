import type { PackedCommitChunk } from '@kira/git-ipc';
import { encodeStreamPayload } from '@kira/git-ipc/codec';

// P92 item 5: `gitStreamMock.ts`'s own doc comment flags `graph.stream` as a known gap (P74/P75)
// — its `resultByMethod` dict only ever answers a plain unary `req`/`res`, and `graph.stream`
// opens as a `t: 'open'` stream, pushing `t: 'chunk'` frames that carry one real binary payload
// (the packed commit rows, FlatBuffers-encoded by `graphChunkCodec.ts`'s `toWire`, wrapped by
// `encodeStreamPayload`). That payload has to cross `page.evaluate`'s own JSON-only argument
// boundary, so this file does the real FlatBuffers encoding here, in Node (reusing the actual
// codec rather than hand-rolling a second copy of `toWire`'s wire format — CLAUDE.md's own
// library-over-hand-roll rule) and hands `installGitStreamMock` the JSON-safe scalar fields plus
// the one binary blob (base64) separately — assembling the actual `0x00 | uint32BE headerLen |
// headerJSON | blob…` blob frame (`blobFrame.ts`'s own layout, run here in the direction that
// file never needs: the real client never sends one) happens in `gitStreamMock.ts` itself, since
// only there does the request's own runtime `id`/`version` exist to fill in the header.

const WIDEST_SAMPLE_TIMESTAMP = Date.UTC(2024, 11, 30, 22, 48) / 1000;

/** A single-commit, zero-parent `PackedCommitChunk` at row 0 — `fakeGraphHost.ts`'s own
 *  `buildPackedChunkAt` (the VS Code interaction suite's analogous fixture), ported here since
 *  that file lives in a different workspace package this app's tests cannot import from. */
export function buildOneCommitChunk(sha: string, subject: string): PackedCommitChunk {
  const shaBytes = Buffer.from(sha, 'hex');
  const subjectBytes = Buffer.from(subject, 'utf8');
  return {
    from: 0,
    to: 1,
    shaWidthBytes: 20,
    shas: shaBytes.buffer.slice(shaBytes.byteOffset, shaBytes.byteOffset + shaBytes.byteLength),
    parentOffsets: Uint32Array.from([0, 0]).buffer,
    parentShas: new ArrayBuffer(0),
    identityIds: Uint32Array.from([0, 1, 0, 1]).buffer,
    times: Uint32Array.from([WIDEST_SAMPLE_TIMESTAMP, WIDEST_SAMPLE_TIMESTAMP]).buffer,
    subjectBytes: subjectBytes.buffer.slice(
      subjectBytes.byteOffset,
      subjectBytes.byteOffset + subjectBytes.byteLength,
    ),
    subjectOffsets: Uint32Array.from([0, subjectBytes.byteLength]).buffer,
    dictionaryBase: 0,
    dictionary: ['Fake Author', 'fake@example.com'],
    decorations: [],
  };
}

/** One `graph.stream` chunk, split for the trip through `page.evaluate`'s JSON-only argument
 *  boundary: `meta` is every scalar chunk field plus `commits.$fb` (JSON-safe, unchanged), `blob`
 *  is the one real `ArrayBuffer` (`commits.d`, base64) — `gitStreamMock.ts` reassembles the two
 *  plus the request's own runtime `id`/`version` (unknowable here, chosen by the client's own
 *  counter) into a real blob frame in-page, `blobFrame.ts`'s own layout run in reverse. */
export interface GraphStreamChunkFixture {
  readonly meta: {
    readonly repoId: string;
    readonly seq: number;
    readonly from: number;
    readonly to: number;
    readonly source: 'git' | 'cache';
    readonly remaining: number;
    readonly exhausted: boolean;
    readonly commitsFb: string;
  };
  readonly blob: string;
}

/** Builds one `graph.stream` chunk fixture, ready for `installGitStreamMock`'s
 *  `graphStreamChunks` option. */
export function buildGraphStreamChunk(
  repoId: string,
  seq: number,
  commits: PackedCommitChunk,
): GraphStreamChunkFixture {
  const encoded = encodeStreamPayload('graph.stream', {
    repoId,
    seq,
    from: seq,
    to: seq + 1,
    source: 'git',
    remaining: 0,
    exhausted: true,
    commits,
  }) as {
    repoId: string;
    seq: number;
    from: number;
    to: number;
    source: 'git' | 'cache';
    remaining: number;
    exhausted: boolean;
    commits: { $fb: string; d: ArrayBuffer };
  };
  return {
    meta: {
      repoId: encoded.repoId,
      seq: encoded.seq,
      from: encoded.from,
      to: encoded.to,
      source: encoded.source,
      remaining: encoded.remaining,
      exhausted: encoded.exhausted,
      commitsFb: encoded.commits.$fb,
    },
    blob: Buffer.from(encoded.commits.d).toString('base64'),
  };
}
