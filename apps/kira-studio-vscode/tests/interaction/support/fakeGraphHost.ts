/**
 * G21 D14: the graph panel's own narrowly-scoped fake-transport fixture — `fakeReviewHost.ts`'s
 * exact shape (four-ish hand-written wire responses, the same real codec, no general mock RPC
 * layer), just aimed at `App.vue`'s own cold-bootstrap path instead of `ReviewView.vue`'s: `app
 * .init`, `repo.list` (the workspace-folder auto-open loop, since this harness's `viewState.read()`
 * always comes back empty — no persisted repoId to skip straight past it with), `repo.open`, and
 * `graph.stream` (the same `t: "open"` streamed method `fakeReviewHost.ts` already answers, one
 * chunk then `end`).
 *
 * One packed commit, timestamped at `dateFormat.ts`'s own `WIDEST_SAMPLE_TIMESTAMP` — so
 * `graph-columns.spec.ts`'s date-cell assertion exercises a real row rather than an empty grid.
 *
 * G-UX D10 (item 2): also answers `graph.refresh` (recording every call onto
 * `window.__graphRefreshCalls`, in arrival order) and `graph.status` — the two requests
 * `GraphViewState`'s own auto-refresh path makes after a `repo.changed`/`refsChanged` event
 * (`#runLoad`'s request-then-resync shape) — and exposes `window.__emitRepoChanged(kind, repoId?)`,
 * which dispatches a real, wire-correct `repo.changed` event frame so `graph-columns.spec.ts` can
 * drive the auto-refresh path end to end without a real watcher or a real `git` process.
 */
import type { DecorationRef, PackedCommitChunk, RefRow, StashEntry } from '@kira/git-ipc';
import { CONTRACT_VERSION } from '@kira/git-ipc';
import { encode, encodeStreamPayload } from '@kira/git-ipc/codec';

export const FAKE_REPO_ROOT = '/fake/repo';
export const FAKE_REPO_ID = '/fake/repo';
export const FAKE_SHA = '2222222222222222222222222222222222222222';
export const FAKE_SUBJECT = 'Add the graph column fixture';
// G32 round-3 performance review, finding #7's own regression fixture: a second, independent
// (zero-parent) commit — `streamTwoChunksThenEnd` below streams it as its OWN chunk, so a test can
// observe what CommitGrid.vue does when a second `graph.stream` chunk lands with the same lane
// count as the first (both are lane-0 roots — see lanes.ts's own "route into a free lane" pass:
// neither has a parent link to continue, so each independently claims the lowest free lane, which
// is lane 0 both times).
export const FAKE_SHA_2 = '3333333333333333333333333333333333333333';
export const FAKE_SUBJECT_2 = 'A second, same-lane commit';
export const OTHER_REPO_ID = '/fake/other-repo';
// P92 item 2's own regression fixture: enough rows to overflow the grid host vertically, so a
// real vertical scrollbar takes layout width — the one condition that reproduces the bogus
// horizontal-scrollbar bug (column widths summed to host.clientWidth, not the narrower
// viewport.clientWidth a vertical scrollbar leaves behind). SlickGrid only renders rows within (or
// just past) its own viewport, so a big count costs this fixture nothing at boot — 300 rows
// comfortably overflows this suite's default 720px viewport at any plausible row height.
const MANY_ROWS_COUNT = 300;
function manyRowsSha(row: number): string {
  return `aa${row.toString(16).padStart(8, '0')}`.padEnd(40, '0');
}
/** `dateFormat.ts`'s own `WIDEST_SAMPLE_TIMESTAMP` (`Date.UTC(2024, 11, 30, 22, 48)`) — kept as a
 *  literal here rather than imported, since that constant is not exported (nothing outside that
 *  module has ever needed the raw timestamp before now) and this fixture lives outside `packages/
 *  git-ui` entirely. `formatAbsoluteDate` renders this same instant as `"2024-12-30 22:48"`. */
const WIDEST_SAMPLE_TIMESTAMP = Date.UTC(2024, 11, 30, 22, 48) / 1000;

function wrap(body: unknown): unknown {
  return encode({ version: CONTRACT_VERSION, body }, 'base64').payload;
}

/** Builds a single-commit, zero-parent `PackedCommitChunk` at row `from` (row `from` to `to`,
 *  always `from + 1`) — shared by `buildPackedChunk` (the one-chunk fixture's own row 0) and
 *  `streamTwoChunksThenEnd`'s two same-lane chunks below.
 *
 *  `dictionary`/`dictionaryBase` default to the one-chunk fixture's own shape (both identity
 *  strings, freshly interned from an empty store). A SECOND chunk in the same stream reusing the
 *  same two strings must NOT re-declare them: `CommitStore.appendPacked` (packages/git-core/src/
 *  store/commitStore.ts) asserts `chunk.dictionaryBase === interner.size` — the delta-encoding
 *  contract `commitStore.ts`'s own doc comment states ("dictionary holds only strings interned
 *  SINCE dictionaryBase"). `streamTwoChunksThenEnd` passes `dictionaryBase: 2, dictionary: []`
 *  for its second chunk accordingly, referencing the first chunk's already-interned indices 0/1
 *  via `identityIds` alone. */
function buildPackedChunkAt(
  sha: string,
  subject: string,
  from: number,
  dictionary: readonly string[] = ['Fake Author', 'fake@example.com'],
  dictionaryBase = 0,
  // P7 (item 1): a single row's own decoration, chunk-relative row 0 always (this fixture only
  // ever builds one-row chunks — `commitStore.ts`'s `appendPacked` reads `chunk.decorations`
  // keyed by the chunk-local index `i`, never the global store row `from + i`).
  decoration: readonly DecorationRef[] = [],
): PackedCommitChunk {
  const shaBytes = Buffer.from(sha, 'hex');
  const subjectBytes = Buffer.from(subject, 'utf8');
  return {
    from,
    to: from + 1,
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
    dictionaryBase,
    dictionary: [...dictionary],
    decorations: decoration.length > 0 ? [[0, decoration]] : [],
  };
}

function buildPackedChunk(): PackedCommitChunk {
  return buildPackedChunkAt(FAKE_SHA, FAKE_SUBJECT, 0);
}

// P93 §8.3: a multi-branch fixture — main (HEAD, 3 commits) plus two feature branches forked at
// different depths off it, one long enough to collapse (n > MIN_COLLAPSIBLE = 3), one not. Store
// rows arrive in an order that satisfies rowPlan.ts's own topo-order precondition (a parent's row
// index is always strictly greater than its child's) without matching DISPLAY order at all — the
// same "arrival order is topological, display order is a permutation of it" gap P93 §2 exists to
// cross:
//
//   row  branch          parent (by row)
//   0    feature-newer   1   (tip, F0)
//   1    feature-newer   2   (F1 — hidden once collapsed)
//   2    feature-newer   3   (F2 — hidden once collapsed)
//   3    feature-newer   4   (F3 — hidden once collapsed)
//   4    feature-newer   8   (oldest own commit, F4 — forks off M1)
//   5    feature-older   6   (tip, G0)
//   6    feature-older   9   (oldest own commit, G1 — forks off M2)
//   7    main (HEAD)     8   (tip, M0)
//   8    main             9   (M1)
//   9    main             -   (root, M2)
//
// feature-newer has 5 own commits, so it collapses by default to tip/placeholder/oldest
// (hiddenCount 3: F1/F2/F3); feature-older has 2, so it always renders in full. feature-newer's
// own ref committerDate is later than feature-older's, so it sorts first among the two (§3.2).
function branchOrderSha(row: number): string {
  return (row + 1).toString(16).padStart(2, '0').repeat(20);
}

export const BRANCH_ORDER_ROW_COUNT = 10;
export const BRANCH_ORDER_SHAS = {
  featureNewerTip: branchOrderSha(0),
  featureNewerOldest: branchOrderSha(4),
  featureOlderTip: branchOrderSha(5),
  featureOlderOldest: branchOrderSha(6),
  mainTip: branchOrderSha(7),
  mainRoot: branchOrderSha(9),
} as const;
export const FEATURE_NEWER_SHORT_NAME = 'feature-newer';
export const FEATURE_OLDER_SHORT_NAME = 'feature-older';
export const FEATURE_NEWER_HIDDEN_COUNT = 3; // F1, F2, F3 — hidden inside the placeholder

const BRANCH_ORDER_SUBJECTS = [
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

/** Row `i`'s own parent, by row — `undefined` for the root (`M2`, row 9). Matches this file's
 *  own doc comment table above exactly. */
const BRANCH_ORDER_PARENT_ROW: readonly (number | undefined)[] = [
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
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

/** The whole multi-branch fixture as one `PackedCommitChunk` — every parent link resolves within
 *  this single chunk (`CommitStore.appendPacked`'s own pending-parent pass, run once the whole
 *  chunk's shas are in the table, resolves a later-row parent same as an already-loaded one), so
 *  no second chunk is needed the way `streamTwoChunksThenEnd` above needs one for its own,
 *  unrelated reason (two independent lane-0 roots). */
function buildBranchOrderChunk(): PackedCommitChunk {
  const rowCount = BRANCH_ORDER_SUBJECTS.length;

  const shaBytes = Buffer.concat(
    Array.from({ length: rowCount }, (_, row) => Buffer.from(branchOrderSha(row), 'hex')),
  );

  const parentOffsets: number[] = [0];
  const parentShaBuffers: Buffer[] = [];
  for (let row = 0; row < rowCount; row++) {
    const parentRow = BRANCH_ORDER_PARENT_ROW[row];
    if (parentRow !== undefined) {
      parentShaBuffers.push(Buffer.from(branchOrderSha(parentRow), 'hex'));
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

  const subjectBuffers = BRANCH_ORDER_SUBJECTS.map((s) => Buffer.from(s, 'utf8'));
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

const BRANCH_ORDER_COMMITTER_DATE_NEWER = WIDEST_SAMPLE_TIMESTAMP + 2000;
const BRANCH_ORDER_COMMITTER_DATE_OLDER = WIDEST_SAMPLE_TIMESTAMP + 1000;

/** `refs.list`'s own answer for the `'branchOrder'` stream mode — `main` (HEAD), plus the two
 *  feature branches at distinct `committerDate`s (§3.2's own ordering key) so `App.vue`'s
 *  `buildGraphTips` sorts feature-newer ahead of feature-older, newest tip first. Unconditional
 *  (see `buildFakeGraphHostInitScript`'s own dispatch: gated on `FIXTURES.refsList` being present
 *  at all, not on `withPickerData` — `RefsState.setRepoId` always requests `refs.list` on repo
 *  open, `withPickerData`'s own four other lists notwithstanding). */
function branchOrderRefsList(id: number): unknown {
  return wrap({
    t: 'res',
    id,
    ok: true,
    result: {
      branches: [
        pickerRef({
          shortName: 'main',
          objectId: BRANCH_ORDER_SHAS.mainTip,
          isHead: true,
          committerDate: WIDEST_SAMPLE_TIMESTAMP,
        }),
        pickerRef({
          shortName: FEATURE_NEWER_SHORT_NAME,
          objectId: BRANCH_ORDER_SHAS.featureNewerTip,
          committerDate: BRANCH_ORDER_COMMITTER_DATE_NEWER,
        }),
        pickerRef({
          shortName: FEATURE_OLDER_SHORT_NAME,
          objectId: BRANCH_ORDER_SHAS.featureOlderTip,
          committerDate: BRANCH_ORDER_COMMITTER_DATE_OLDER,
        }),
      ],
      remoteBranches: [],
      tags: [],
      head: { kind: 'branch', name: 'main' },
    },
  });
}

// P77 §17.2: `branch-picker.spec.ts`'s own seed data for the five picker-tab requests
// (`refs.list`/`stash.list`/`globalStash.list`/`worktree.list`/`stack.list`) — one row per tab,
// with `feature-auth`/`auth work` both matching a `"auth"` query so that spec's own cross-tab
// filter case (§17.2 case 3) has a real second tab to land on.
function pickerRef(overrides: Partial<RefRow> & { shortName: string }): RefRow {
  return {
    refname: `refs/heads/${overrides.shortName}`,
    kind: 'branch',
    objectId: FAKE_SHA,
    peeledObjectId: undefined,
    upstream: undefined,
    track: undefined,
    committerDate: WIDEST_SAMPLE_TIMESTAMP,
    isHead: false,
    checkedOutIn: undefined,
    annotation: undefined,
    ...overrides,
  };
}

function pickerStash(overrides: Partial<StashEntry> & { sha: string }): StashEntry {
  return {
    index: 0,
    baseSha: FAKE_SHA,
    baseSubject: FAKE_SUBJECT,
    indexSha: FAKE_SHA,
    untrackedSha: undefined,
    message: 'On main: something else',
    branch: 'main',
    timestamp: WIDEST_SAMPLE_TIMESTAMP,
    fileCount: 1,
    includedUntracked: false,
    scope: 'stack',
    ref: '',
    ...overrides,
  };
}

function buildResponses(): {
  appInit: (id: number) => unknown;
  repoList: (id: number) => unknown;
  repoOpen: (id: number) => unknown;
  streamChunkThenEnd: (id: number) => readonly [unknown, unknown];
  streamTwoChunksThenEnd: (id: number) => readonly [unknown, unknown, unknown];
  streamOneDecoratedOneNot: (id: number) => readonly [unknown, unknown, unknown];
  streamManyRows: (id: number) => readonly unknown[];
  streamTwoChunksSecondDecorated: (id: number) => readonly [unknown, unknown, unknown];
  streamBranchOrder: (id: number) => readonly [unknown, unknown];
  graphRefresh: (id: number) => unknown;
  graphStatus: (id: number) => unknown;
  repoChanged: (kind: 'refsChanged' | 'worktreeChanged', repoId: string) => unknown;
  refsList: (id: number) => unknown;
  branchOrderRefsList: (id: number) => unknown;
  stashList: (id: number) => unknown;
  globalStashList: (id: number) => unknown;
  worktreeList: (id: number) => unknown;
  stackList: (id: number) => unknown;
} {
  return {
    appInit: (id) =>
      wrap({
        t: 'res',
        id,
        ok: true,
        result: {
          host: 'vscode',
          contractVersion: CONTRACT_VERSION,
          settings: { 'workbench.tree.indent': 8 },
          git: { kind: 'ok', path: '/usr/bin/git', version: '2.42.0' },
          capabilities: {
            openInEditor: true,
            goToFile: true,
            clipboard: true,
            resolveConflict: true,
          },
        },
      }),
    repoList: (id) =>
      wrap({
        t: 'res',
        id,
        ok: true,
        result: {
          candidates: [{ path: FAKE_REPO_ROOT, label: 'fake-repo' }],
          activeRepoId: null,
        },
      }),
    repoOpen: (id) =>
      wrap({
        t: 'res',
        id,
        ok: true,
        result: {
          kind: 'ok',
          repo: {
            repoId: FAKE_REPO_ID,
            root: FAKE_REPO_ROOT,
            gitDir: `${FAKE_REPO_ROOT}/.git`,
            commonDir: `${FAKE_REPO_ROOT}/.git`,
            isBare: false,
            isLinkedWorktree: false,
            head: { kind: 'branch', name: 'main' },
          },
        },
      }),
    streamChunkThenEnd: (id) => {
      const chunk = encodeStreamPayload('graph.stream', {
        repoId: FAKE_REPO_ID,
        seq: 0,
        from: 0,
        to: 1,
        source: 'git',
        remaining: 0,
        exhausted: true,
        commits: buildPackedChunk(),
      });
      return [wrap({ t: 'chunk', id, chunk }), wrap({ t: 'end', id })] as const;
    },
    // G32 round-3 performance review, finding #7's own fixture: two chunks, each one independent
    // zero-parent commit at lane 0 (see FAKE_SHA_2's own doc comment above) — `graph-columns.spec
    // .ts`'s own single-chunk fixture cannot exercise "does a SECOND chunk trigger a redundant
    // column rebuild", since there is only ever one chunk to begin with.
    streamTwoChunksThenEnd: (id) => {
      const chunk1 = encodeStreamPayload('graph.stream', {
        repoId: FAKE_REPO_ID,
        seq: 0,
        from: 0,
        to: 1,
        source: 'git',
        remaining: 1,
        exhausted: false,
        commits: buildPackedChunkAt(FAKE_SHA, FAKE_SUBJECT, 0),
      });
      const chunk2 = encodeStreamPayload('graph.stream', {
        repoId: FAKE_REPO_ID,
        seq: 1,
        from: 1,
        to: 2,
        source: 'git',
        remaining: 0,
        exhausted: true,
        commits: buildPackedChunkAt(FAKE_SHA_2, FAKE_SUBJECT_2, 1, [], 2),
      });
      return [
        wrap({ t: 'chunk', id, chunk: chunk1 }),
        wrap({ t: 'chunk', id, chunk: chunk2 }),
        wrap({ t: 'end', id }),
      ] as const;
    },
    // P7 (item 1): row 0 undecorated (compact height), row 1 carries a real ref decoration (a
    // lightweight tag — the simplest `DecorationRef` kind, no PR/stack lookups involved) so
    // `graph-columns.spec.ts` can assert the two rows' real, rendered heights differ and that
    // each row's own graph-column node sits on its own subject line, not the row's midpoint.
    streamOneDecoratedOneNot: (id) => {
      const chunk1 = encodeStreamPayload('graph.stream', {
        repoId: FAKE_REPO_ID,
        seq: 0,
        from: 0,
        to: 1,
        source: 'git',
        remaining: 1,
        exhausted: false,
        commits: buildPackedChunkAt(FAKE_SHA, FAKE_SUBJECT, 0),
      });
      const chunk2 = encodeStreamPayload('graph.stream', {
        repoId: FAKE_REPO_ID,
        seq: 1,
        from: 1,
        to: 2,
        source: 'git',
        remaining: 0,
        exhausted: true,
        commits: buildPackedChunkAt(FAKE_SHA_2, FAKE_SUBJECT_2, 1, [], 2, [
          { kind: 'tag', name: 'v1' },
        ]),
      });
      return [
        wrap({ t: 'chunk', id, chunk: chunk1 }),
        wrap({ t: 'chunk', id, chunk: chunk2 }),
        wrap({ t: 'end', id }),
      ] as const;
    },
    // P92 item 2: MANY_ROWS_COUNT one-row chunks, dispatched back to back (no pause point needed
    // — the bug this reproduces is a layout fact about the settled grid, not a streaming-pacing
    // one) — row 0 declares the two identity strings, every row after reuses them via
    // `dictionaryBase: 2, dictionary: []`, the same convention `streamTwoChunksThenEnd` above
    // already establishes for a second chunk in one stream.
    streamManyRows: (id) => {
      const chunks = Array.from({ length: MANY_ROWS_COUNT }, (_, row) =>
        wrap({
          t: 'chunk',
          id,
          chunk: encodeStreamPayload('graph.stream', {
            repoId: FAKE_REPO_ID,
            seq: row,
            from: row,
            to: row + 1,
            source: 'git',
            remaining: MANY_ROWS_COUNT - 1 - row,
            exhausted: row === MANY_ROWS_COUNT - 1,
            commits:
              row === 0
                ? buildPackedChunkAt(manyRowsSha(0), `Row ${0}`, 0)
                : buildPackedChunkAt(manyRowsSha(row), `Row ${row}`, row, [], 2),
          }),
        }),
      );
      return [...chunks, wrap({ t: 'end', id })] as const;
    },
    // P92 item 4: `twoChunksSameLane`'s own pause point (chunk 2 held back until the test calls
    // `window.__releaseSecondGraphChunk()`), but chunk 2 carries `streamOneDecoratedOneNot`'s own
    // tag decoration — a row's height growing strictly AFTER SlickGrid has already rendered row 0
    // is the exact shape the row-overlap bug (§3) needs: a decoration landing at boot (this
    // fixture's other two decorated modes) never gives a "before" render to compare positions
    // against.
    streamTwoChunksSecondDecorated: (id) => {
      const chunk1 = encodeStreamPayload('graph.stream', {
        repoId: FAKE_REPO_ID,
        seq: 0,
        from: 0,
        to: 1,
        source: 'git',
        remaining: 1,
        exhausted: false,
        commits: buildPackedChunkAt(FAKE_SHA, FAKE_SUBJECT, 0),
      });
      const chunk2 = encodeStreamPayload('graph.stream', {
        repoId: FAKE_REPO_ID,
        seq: 1,
        from: 1,
        to: 2,
        source: 'git',
        remaining: 0,
        exhausted: true,
        commits: buildPackedChunkAt(FAKE_SHA_2, FAKE_SUBJECT_2, 1, [], 2, [
          { kind: 'tag', name: 'v1' },
        ]),
      });
      return [
        wrap({ t: 'chunk', id, chunk: chunk1 }),
        wrap({ t: 'chunk', id, chunk: chunk2 }),
        wrap({ t: 'end', id }),
      ] as const;
    },
    // P93 §8.3: the multi-branch fixture (`buildBranchOrderChunk` above) as one `graph.stream`
    // chunk — every parent link resolves within it, so (unlike `twoChunksSameLane`) one chunk is
    // enough.
    streamBranchOrder: (id) => {
      const chunk = encodeStreamPayload('graph.stream', {
        repoId: FAKE_REPO_ID,
        seq: 0,
        from: 0,
        to: BRANCH_ORDER_ROW_COUNT,
        source: 'git',
        remaining: 0,
        exhausted: true,
        commits: buildBranchOrderChunk(),
      });
      return [wrap({ t: 'chunk', id, chunk }), wrap({ t: 'end', id })] as const;
    },
    // G-UX D10: `GraphViewState.refresh()`'s own `graph.refresh` request — `#runLoad`'s resync
    // then re-opens `graph.stream` from the current `loadedRows` (already answered generically by
    // `streamChunkThenEnd` above, reused verbatim: its `from: 0` on an already-1-row store is
    // `#applyChunk`'s own restart-at-zero *reset* detection, not an error).
    graphRefresh: (id) => wrap({ t: 'res', id, ok: true, result: { restarted: true } }),
    // `#runLoad`'s own post-resync `graph.status` call — answered as "nothing more to load",
    // matching `streamChunkThenEnd`'s `exhausted: true`.
    graphStatus: (id) =>
      wrap({ t: 'res', id, ok: true, result: { loaded: 1, remaining: 0, exhausted: true } }),
    repoChanged: (kind, repoId) =>
      wrap({ t: 'evt', method: 'repo.changed', payload: { repoId, kind } }),
    // G-UX (item 13): mirrors `repoChanged` above — `window.__emitConnectionChanged` (below)
    // dispatches one of these on demand, the same "no reload, no re-mount" live-push path
    // `panelView.ts`'s own `notifyConnectionState` drives in the real extension.
    connectionChanged: (state: { kind: string; detail?: string }) =>
      wrap({ t: 'evt', method: 'connection.changed', payload: { state } }),
    // P77 §17.2: BranchPicker.vue's own five tabs, seeded so `branch-picker.spec.ts` sees a
    // nonzero, distinct badge on every one — `main` (HEAD) and `feature-auth` on Branches,
    // `v1` on Tags, one stack entry (`"auth work"`, matching the same spec's `"auth"` query) on
    // Stashes, one worktree and one stacked branch on Worktrees/Stacks.
    refsList: (id) =>
      wrap({
        t: 'res',
        id,
        ok: true,
        result: {
          branches: [
            pickerRef({ shortName: 'main', isHead: true }),
            pickerRef({ shortName: 'feature-auth' }),
          ],
          remoteBranches: [],
          tags: [pickerRef({ shortName: 'v1', refname: 'refs/tags/v1', kind: 'tag' })],
          head: { kind: 'branch', name: 'main' },
        },
      }),
    branchOrderRefsList,
    stashList: (id) =>
      wrap({
        t: 'res',
        id,
        ok: true,
        result: {
          entries: [
            pickerStash({
              sha: '4444444444444444444444444444444444444444',
              message: 'On main: auth work',
            }),
          ],
        },
      }),
    globalStashList: (id) => wrap({ t: 'res', id, ok: true, result: { entries: [] } }),
    worktreeList: (id) =>
      wrap({
        t: 'res',
        id,
        ok: true,
        result: {
          worktrees: [
            {
              path: FAKE_REPO_ROOT,
              head: FAKE_SHA,
              branch: 'refs/heads/main',
              isBare: false,
              isDetached: false,
              isMain: true,
              isCurrent: true,
              locked: null,
              prunable: null,
              openElsewhere: false,
            },
          ],
        },
      }),
    stackList: (id) =>
      wrap({
        t: 'res',
        id,
        ok: true,
        result: {
          stacks: [
            {
              base: 'main',
              baseTip: FAKE_SHA,
              needsRestack: false,
              branches: [
                {
                  name: 'stacked-branch',
                  parent: 'main',
                  depth: 0,
                  tip: FAKE_SHA,
                  parentTip: FAKE_SHA,
                  recordedBase: FAKE_SHA,
                  behind: 0,
                  ahead: 1,
                  state: 'upToDate',
                  checkedOutIn: undefined,
                  track: undefined,
                  isHead: false,
                },
              ],
            },
          ],
          orphans: [],
        },
      }),
  };
}

/**
 * Builds the plain-JS string installed via `page.addInitScript` — `fakeReviewHost.ts`'s own
 * `buildFakeHostInitScript`, aimed at the graph panel's cold-bootstrap sequence instead: `app
 * .init`, then (since this harness's `ViewStateStore` always reads back empty) `repo.list`'s
 * workspace-folder loop, `repo.open` for the one candidate it offers, and finally `graph.stream`'s
 * open/chunk/end. Every other method (`refs.list`, `repoSettings.get`, …) is deliberately left
 * unanswered, matching `fakeReviewHost.ts`'s own documented scope — neither spec built on this
 * fixture asserts on anything that depends on one of them resolving.
 *
 * G-UX D10: also answers `graph.refresh`/`graph.status` (recording every `graph.refresh` call
 * onto `window.__graphRefreshCalls`) and exposes `window.__emitRepoChanged(kind, repoId?)` —
 * `graph-columns.spec.ts`'s own auto-refresh case dispatches a `repo.changed` event through it and
 * polls `window.__graphRefreshCalls` rather than driving a real watcher.
 *
 * `options.streamMode` (G32 round-3 performance review, finding #7): `'oneChunk'` (default) is
 * every existing spec's own fixture, unchanged. `'twoChunksSameLane'` streams `FAKE_SHA` as
 * before, then withholds the second chunk (`FAKE_SHA_2`) and the stream's own `end` frame until
 * the test calls `window.__releaseSecondGraphChunk()` — giving a spec a real pause point between
 * the two chunks landing, which "dispatch every frame back to back" cannot offer (there is no
 * async boundary a test could otherwise observe between them). `'oneDecoratedOneNot'` (P7, item 1)
 * streams both `FAKE_SHA`/`FAKE_SHA_2` immediately, one after the other with no pause point —
 * `FAKE_SHA` undecorated, `FAKE_SHA_2` carrying a real tag decoration — so a spec can compare the
 * two rows' own real, rendered heights and node positions directly. `'manyRows'` (P92 item 2)
 * streams `MANY_ROWS_COUNT` one-row chunks immediately, all synchronous — enough rows to give the
 * grid host a real vertical scrollbar, the one condition that reproduces the "column widths
 * summed to host width, not the narrower viewport width a scrollbar leaves" bug. `'branchOrder'`
 * (P93 §8.3) streams the multi-branch fixture (`buildBranchOrderChunk` — `main` plus two feature
 * branches forked at different depths) as one chunk, and also answers `refs.list` (unconditionally
 * — see `data.refsList`'s own comment below) with those three branches' real `committerDate`s, so
 * `App.vue`'s branch ordering has real ref data to sort by.
 *
 * `options.withPickerData` (P77 §17.2): additive, the same shape `streamMode` already set —
 * every existing caller keeps hanging on `refs.list`/`stash.list`/`globalStash.list`/
 * `worktree.list`/`stack.list` (this file's own doc comment's "deliberately unanswered" list)
 * unless it opts in. `true` answers all five with `pickerRef`/`pickerStash`'s seed data, which is
 * what `App.vue`'s own `setRepoId` sweep requests right after `repo.open` resolves — needed for
 * `branch-picker.spec.ts` to see anything but empty tabs.
 */
export function buildFakeGraphHostInitScript(options?: {
  readonly streamMode?:
    | 'oneChunk'
    | 'twoChunksSameLane'
    | 'oneDecoratedOneNot'
    | 'manyRows'
    | 'twoChunksSecondDecorated'
    | 'branchOrder';
  readonly withPickerData?: boolean;
}): string {
  const responses = buildResponses();
  const streamMode = options?.streamMode ?? 'oneChunk';
  const withPickerData = options?.withPickerData ?? false;
  const data = {
    appInit: responses.appInit(0),
    repoList: responses.repoList(0),
    repoOpen: responses.repoOpen(0),
    stream:
      streamMode === 'twoChunksSameLane'
        ? responses.streamTwoChunksThenEnd(0)
        : streamMode === 'oneDecoratedOneNot'
          ? responses.streamOneDecoratedOneNot(0)
          : streamMode === 'manyRows'
            ? responses.streamManyRows(0)
            : streamMode === 'twoChunksSecondDecorated'
              ? responses.streamTwoChunksSecondDecorated(0)
              : streamMode === 'branchOrder'
                ? responses.streamBranchOrder(0)
                : responses.streamChunkThenEnd(0),
    graphRefresh: responses.graphRefresh(0),
    graphStatus: responses.graphStatus(0),
    repoChangedRefs: responses.repoChanged('refsChanged', FAKE_REPO_ID),
    repoChangedWorktree: responses.repoChanged('worktreeChanged', FAKE_REPO_ID),
    repoChangedOtherRepo: responses.repoChanged('refsChanged', OTHER_REPO_ID),
    // G-UX (item 13): every state `window.__emitConnectionChanged`'s own callers below actually
    // use — not the full five-kind union, since a fixture answers only what its own specs ask
    // for, same as every other precomputed envelope in this file.
    connectionChangedConnecting: responses.connectionChanged({ kind: 'connecting' }),
    connectionChangedPairing: responses.connectionChanged({ kind: 'pairing' }),
    connectionChangedDenied: responses.connectionChanged({
      kind: 'denied',
      detail: 'Pairing was denied',
    }),
    connectionChangedConnected: responses.connectionChanged({ kind: 'connected' }),
    ...(withPickerData
      ? {
          refsList: responses.refsList(0),
          stashList: responses.stashList(0),
          globalStashList: responses.globalStashList(0),
          worktreeList: responses.worktreeList(0),
          stackList: responses.stackList(0),
        }
      : {}),
    // P93 §8.3: `refs.list` always fires on `repo.open` (`RefsState.setRepoId`, unconditional —
    // not gated on `withPickerData`'s own picker-tab concept), and `App.vue`'s own branch-ordering
    // needs its real branches/committerDates, not the two-branch picker seed above.
    ...(streamMode === 'branchOrder' ? { refsList: responses.branchOrderRefsList(0) } : {}),
  };
  const fixtureJson = JSON.stringify(data);

  return `
    (() => {
      const FIXTURES = ${fixtureJson};
      const STREAM_MODE = ${JSON.stringify(streamMode)};
      const WITH_PICKER_DATA = ${JSON.stringify(withPickerData)};
      window.__graphRefreshCalls = [];

      function withId(template, id) {
        const clone = JSON.parse(JSON.stringify(template));
        clone.body.id = id;
        return clone;
      }

      function dispatch(envelope) {
        window.dispatchEvent(new MessageEvent('message', { data: envelope }));
      }

      // G32 round-3 performance review, finding #7: holds the second chunk + the stream's own
      // 'end' frame back until the test explicitly calls window.__releaseSecondGraphChunk() —
      // giving a spec a real pause point to act in between the two chunks landing, which
      // dispatching every frame back to back in one synchronous pass cannot offer.
      window.__releaseSecondGraphChunk = () => {};

      window.__emitRepoChanged = (kind, repoId) => {
        const key =
          repoId === ${JSON.stringify(OTHER_REPO_ID)}
            ? 'repoChangedOtherRepo'
            : kind === 'worktreeChanged'
              ? 'repoChangedWorktree'
              : 'repoChangedRefs';
        dispatch(FIXTURES[key]);
      };

      // G-UX (item 13): drives BridgeClient.hostConnection's own live-push path (the
      // 'connection.changed' subscription) without a reload — 'kind' picks one of the four
      // precomputed envelopes above.
      window.__emitConnectionChanged = (kind) => {
        const key = {
          connecting: 'connectionChangedConnecting',
          pairing: 'connectionChangedPairing',
          denied: 'connectionChangedDenied',
          connected: 'connectionChangedConnected',
        }[kind];
        if (!key) throw new Error('fakeGraphHost: unknown connection.changed kind ' + kind);
        dispatch(FIXTURES[key]);
      };

      window.acquireVsCodeApi = () => ({
        postMessage(message) {
          const body = message && message.body;
          if (!body) return;
          if (body.t === 'req' && body.method === 'app.init') {
            dispatch(withId(FIXTURES.appInit, body.id));
            return;
          }
          if (body.t === 'req' && body.method === 'repo.list') {
            dispatch(withId(FIXTURES.repoList, body.id));
            return;
          }
          if (body.t === 'req' && body.method === 'repo.open') {
            dispatch(withId(FIXTURES.repoOpen, body.id));
            return;
          }
          if (body.t === 'open' && body.method === 'graph.stream') {
            if (STREAM_MODE === 'twoChunksSameLane' || STREAM_MODE === 'twoChunksSecondDecorated') {
              const [chunk1Envelope, chunk2Envelope, endEnvelope] = FIXTURES.stream;
              dispatch(withId(chunk1Envelope, body.id));
              window.__releaseSecondGraphChunk = () => {
                dispatch(withId(chunk2Envelope, body.id));
                dispatch(withId(endEnvelope, body.id));
              };
              return;
            }
            if (STREAM_MODE === 'oneDecoratedOneNot') {
              const [chunk1Envelope, chunk2Envelope, endEnvelope] = FIXTURES.stream;
              dispatch(withId(chunk1Envelope, body.id));
              dispatch(withId(chunk2Envelope, body.id));
              dispatch(withId(endEnvelope, body.id));
              return;
            }
            if (STREAM_MODE === 'manyRows') {
              for (const envelope of FIXTURES.stream) dispatch(withId(envelope, body.id));
              return;
            }
            const [chunkEnvelope, endEnvelope] = FIXTURES.stream;
            dispatch(withId(chunkEnvelope, body.id));
            dispatch(withId(endEnvelope, body.id));
            return;
          }
          if (body.t === 'req' && body.method === 'graph.refresh') {
            window.__graphRefreshCalls.push({ repoId: body.params && body.params.repoId, at: Date.now() });
            dispatch(withId(FIXTURES.graphRefresh, body.id));
            return;
          }
          if (body.t === 'req' && body.method === 'graph.status') {
            dispatch(withId(FIXTURES.graphStatus, body.id));
            return;
          }
          // FIXTURES.refsList is set either by withPickerData (the five-tab picker seed) or by
          // streamMode === 'branchOrder' (P93 §8.3's own branches) — refs.list fires unconditionally
          // on repo.open (RefsState.setRepoId), so gate on the fixture's presence, not WITH_PICKER_DATA.
          if (FIXTURES.refsList && body.t === 'req' && body.method === 'refs.list') {
            dispatch(withId(FIXTURES.refsList, body.id));
            return;
          }
          if (WITH_PICKER_DATA && body.t === 'req' && body.method === 'stash.list') {
            dispatch(withId(FIXTURES.stashList, body.id));
            return;
          }
          if (WITH_PICKER_DATA && body.t === 'req' && body.method === 'globalStash.list') {
            dispatch(withId(FIXTURES.globalStashList, body.id));
            return;
          }
          if (WITH_PICKER_DATA && body.t === 'req' && body.method === 'worktree.list') {
            dispatch(withId(FIXTURES.worktreeList, body.id));
            return;
          }
          if (WITH_PICKER_DATA && body.t === 'req' && body.method === 'stack.list') {
            dispatch(withId(FIXTURES.stackList, body.id));
            return;
          }
          // Every other method is deliberately left unanswered — see this file's own doc comment.
        },
        getState() {
          return undefined;
        },
        setState() {},
      });
    })();
  `;
}
