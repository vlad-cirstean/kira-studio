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

// P93 §8.4: a multi-branch fixture ported from `fakeGraphHost.ts`'s own `buildBranchOrderChunk`
// (the VS Code interaction suite's analogous fixture — that file lives in a different workspace
// package this app's tests cannot import from, so the table and the packing logic are duplicated
// here rather than shared). Same shape: `main` (HEAD, 3 commits) plus two feature branches forked
// off it at different depths, one long enough to collapse (n > MIN_COLLAPSIBLE = 3), one not.
// Store rows arrive in topo order (a parent's row index is always strictly greater than its
// child's), not display order — see `fakeGraphHost.ts`'s own doc comment for the full row/parent
// table this mirrors.
function multiBranchSha(row: number): string {
  return (row + 1).toString(16).padStart(2, '0').repeat(20);
}

export const MULTI_BRANCH_ROW_COUNT = 10;
export const MULTI_BRANCH_SHAS = {
  featureNewerTip: multiBranchSha(0),
  featureNewerOldest: multiBranchSha(4),
  featureOlderTip: multiBranchSha(5),
  featureOlderOldest: multiBranchSha(6),
  mainTip: multiBranchSha(7),
  mainRoot: multiBranchSha(9),
} as const;
export const MULTI_BRANCH_FEATURE_NEWER_NAME = 'feature-newer';
export const MULTI_BRANCH_FEATURE_OLDER_NAME = 'feature-older';
export const MULTI_BRANCH_FEATURE_NEWER_HIDDEN_COUNT = 3; // F1, F2, F3 — hidden once collapsed

const MULTI_BRANCH_SUBJECTS = [
  'feature-newer tip (F0)',
  'feature-newer F1',
  'feature-newer F2',
  'feature-newer F3',
  'feature-newer oldest (F4)',
  'feature-older tip (G0)',
  'feature-older oldest (G1)',
  'main tip (M0)',
  'main M1',
  'main root (M2)',
] as const;

/** Row `i`'s own parent, by row — `undefined` for the root (`M2`, row 9). */
const MULTI_BRANCH_PARENT_ROW: readonly (number | undefined)[] = [
  1,
  2,
  3,
  4,
  8,
  6,
  9,
  8,
  9,
  undefined,
];

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

/** The whole multi-branch fixture as one `PackedCommitChunk` — every parent link resolves within
 *  this single chunk, so one `graph.stream` chunk (`buildGraphStreamChunk` below) is enough. */
export function buildMultiBranchChunk(): PackedCommitChunk {
  const rowCount = MULTI_BRANCH_SUBJECTS.length;

  const shaBytes = Buffer.concat(
    Array.from({ length: rowCount }, (_, row) => Buffer.from(multiBranchSha(row), 'hex')),
  );

  const parentOffsets: number[] = [0];
  const parentShaBuffers: Buffer[] = [];
  for (let row = 0; row < rowCount; row++) {
    const parentRow = MULTI_BRANCH_PARENT_ROW[row];
    if (parentRow !== undefined) {
      parentShaBuffers.push(Buffer.from(multiBranchSha(parentRow), 'hex'));
    }
    parentOffsets.push(parentShaBuffers.length);
  }
  const parentShaBytes = Buffer.concat(parentShaBuffers);

  const identityIds = new Uint32Array(rowCount * 4);
  const times = new Uint32Array(rowCount * 2);
  for (let row = 0; row < rowCount; row++) {
    identityIds.set([0, 1, 0, 1], row * 4);
    times.set([WIDEST_SAMPLE_TIMESTAMP, WIDEST_SAMPLE_TIMESTAMP], row * 2);
  }

  const subjectBuffers = MULTI_BRANCH_SUBJECTS.map((s) => Buffer.from(s, 'utf8'));
  const subjectBytes = Buffer.concat(subjectBuffers);
  const subjectOffsets = new Uint32Array(rowCount + 1);
  let cursor = 0;
  for (let row = 0; row < rowCount; row++) {
    subjectOffsets[row] = cursor;
    cursor += subjectBuffers[row].byteLength;
  }
  subjectOffsets[rowCount] = cursor;

  return {
    from: 0,
    to: rowCount,
    shaWidthBytes: 20,
    shas: toArrayBuffer(shaBytes),
    parentOffsets: Uint32Array.from(parentOffsets).buffer,
    parentShas: toArrayBuffer(parentShaBytes),
    identityIds: identityIds.buffer,
    times: times.buffer,
    subjectBytes: toArrayBuffer(subjectBytes),
    subjectOffsets: subjectOffsets.buffer,
    dictionaryBase: 0,
    dictionary: ['Fake Author', 'fake@example.com'],
    decorations: [],
  };
}

const MULTI_BRANCH_COMMITTER_DATE_NEWER = WIDEST_SAMPLE_TIMESTAMP + 2000;
const MULTI_BRANCH_COMMITTER_DATE_OLDER = WIDEST_SAMPLE_TIMESTAMP + 1000;

/** `refs.list`'s own result shape (`gitStreamMock.ts`'s `extraResults` — a plain `result` object,
 *  unlike `fakeGraphHost.ts`'s own `wrap()`-ed response), for `installGitStreamMock`'s
 *  `extraResults` option. `main` (HEAD) plus the two feature branches at distinct
 *  `committerDate`s so `App.vue`'s `buildGraphTips` sorts feature-newer ahead of feature-older,
 *  newest tip first. */
export function buildMultiBranchRefsList(): unknown {
  return {
    branches: [
      {
        refname: 'refs/heads/main',
        kind: 'branch',
        shortName: 'main',
        objectId: MULTI_BRANCH_SHAS.mainTip,
        peeledObjectId: undefined,
        upstream: undefined,
        track: undefined,
        committerDate: WIDEST_SAMPLE_TIMESTAMP,
        isHead: true,
        checkedOutIn: undefined,
        annotation: undefined,
      },
      {
        refname: `refs/heads/${MULTI_BRANCH_FEATURE_NEWER_NAME}`,
        kind: 'branch',
        shortName: MULTI_BRANCH_FEATURE_NEWER_NAME,
        objectId: MULTI_BRANCH_SHAS.featureNewerTip,
        peeledObjectId: undefined,
        upstream: undefined,
        track: undefined,
        committerDate: MULTI_BRANCH_COMMITTER_DATE_NEWER,
        isHead: false,
        checkedOutIn: undefined,
        annotation: undefined,
      },
      {
        refname: `refs/heads/${MULTI_BRANCH_FEATURE_OLDER_NAME}`,
        kind: 'branch',
        shortName: MULTI_BRANCH_FEATURE_OLDER_NAME,
        objectId: MULTI_BRANCH_SHAS.featureOlderTip,
        peeledObjectId: undefined,
        upstream: undefined,
        track: undefined,
        committerDate: MULTI_BRANCH_COMMITTER_DATE_OLDER,
        isHead: false,
        checkedOutIn: undefined,
        annotation: undefined,
      },
    ],
    remoteBranches: [],
    tags: [],
    head: { kind: 'branch', name: 'main' },
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
