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
 */
import type { PackedCommitChunk } from '@kira/git-ipc';
import { CONTRACT_VERSION } from '@kira/git-ipc';
import { encode, encodeStreamPayload } from '@kira/git-ipc/codec';

export const FAKE_REPO_ROOT = '/fake/repo';
export const FAKE_REPO_ID = '/fake/repo';
export const FAKE_SHA = '2222222222222222222222222222222222222222';
export const FAKE_SUBJECT = 'Add the graph column fixture';
/** `dateFormat.ts`'s own `WIDEST_SAMPLE_TIMESTAMP` (`Date.UTC(2024, 11, 30, 22, 48)`) — kept as a
 *  literal here rather than imported, since that constant is not exported (nothing outside that
 *  module has ever needed the raw timestamp before now) and this fixture lives outside `packages/
 *  git-ui` entirely. `formatAbsoluteDate` renders this same instant as `"2024-12-30 22:48"`. */
const WIDEST_SAMPLE_TIMESTAMP = Date.UTC(2024, 11, 30, 22, 48) / 1000;

function wrap(body: unknown): unknown {
  return encode({ version: CONTRACT_VERSION, body }, 'base64').payload;
}

function buildPackedChunk(): PackedCommitChunk {
  const shaBytes = Buffer.from(FAKE_SHA, 'hex');
  const subjectBytes = Buffer.from(FAKE_SUBJECT, 'utf8');
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

function buildResponses(): {
  appInit: (id: number) => unknown;
  repoList: (id: number) => unknown;
  repoOpen: (id: number) => unknown;
  streamChunkThenEnd: (id: number) => readonly [unknown, unknown];
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
 */
export function buildFakeGraphHostInitScript(): string {
  const responses = buildResponses();
  const data = {
    appInit: responses.appInit(0),
    repoList: responses.repoList(0),
    repoOpen: responses.repoOpen(0),
    stream: responses.streamChunkThenEnd(0),
  };
  const fixtureJson = JSON.stringify(data);

  return `
    (() => {
      const FIXTURES = ${fixtureJson};

      function withId(template, id) {
        const clone = JSON.parse(JSON.stringify(template));
        clone.body.id = id;
        return clone;
      }

      function dispatch(envelope) {
        window.dispatchEvent(new MessageEvent('message', { data: envelope }));
      }

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
            const [chunkEnvelope, endEnvelope] = FIXTURES.stream;
            dispatch(withId(chunkEnvelope, body.id));
            dispatch(withId(endEnvelope, body.id));
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
