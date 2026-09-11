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
import type { PackedCommitChunk } from '@kira/git-ipc';
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
    decorations: [],
  };
}

function buildPackedChunk(): PackedCommitChunk {
  return buildPackedChunkAt(FAKE_SHA, FAKE_SUBJECT, 0);
}

function buildResponses(): {
  appInit: (id: number) => unknown;
  repoList: (id: number) => unknown;
  repoOpen: (id: number) => unknown;
  streamChunkThenEnd: (id: number) => readonly [unknown, unknown];
  streamTwoChunksThenEnd: (id: number) => readonly [unknown, unknown, unknown];
  graphRefresh: (id: number) => unknown;
  graphStatus: (id: number) => unknown;
  repoChanged: (kind: 'refsChanged' | 'worktreeChanged', repoId: string) => unknown;
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
 * async boundary a test could otherwise observe between them).
 */
export function buildFakeGraphHostInitScript(options?: {
  readonly streamMode?: 'oneChunk' | 'twoChunksSameLane';
}): string {
  const responses = buildResponses();
  const streamMode = options?.streamMode ?? 'oneChunk';
  const data = {
    appInit: responses.appInit(0),
    repoList: responses.repoList(0),
    repoOpen: responses.repoOpen(0),
    stream:
      streamMode === 'twoChunksSameLane'
        ? responses.streamTwoChunksThenEnd(0)
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
  };
  const fixtureJson = JSON.stringify(data);

  return `
    (() => {
      const FIXTURES = ${fixtureJson};
      const STREAM_MODE = ${JSON.stringify(streamMode)};
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
            if (STREAM_MODE === 'twoChunksSameLane') {
              const [chunk1Envelope, chunk2Envelope, endEnvelope] = FIXTURES.stream;
              dispatch(withId(chunk1Envelope, body.id));
              window.__releaseSecondGraphChunk = () => {
                dispatch(withId(chunk2Envelope, body.id));
                dispatch(withId(endEnvelope, body.id));
              };
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
