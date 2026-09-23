/**
 * G19 §4.2/§8.4: the narrowly-scoped fake-transport fixture for the review sidebar's interaction
 * tier — hand-written fake responses (`app.init`, `review.resolveBase`, `graph.stream`,
 * `commit.detail`, `editor.openDiff`, and, since P75 §8, `review.files`/`editor.openAllChanges`/
 * `graph.revealCommit`), not a general-purpose mock RPC layer. Built here, in Node, using the
 * exact same wire codec (`@kira/git-ipc/codec`) the real extension host and webview both use, so
 * the bytes this fixture hands the page are genuinely wire-correct — including `graph.stream`'s
 * own FlatBuffers-encoded `commits` column, never hand-rolled binary.
 *
 * `buildFakeHostInitScript()` returns a self-contained string of plain JS with every response
 * already baked in as literals — installed via Playwright's `page.addInitScript` *before* the
 * webview's own bundle runs, so by the time `webview/main.ts` calls `acquireVsCodeApi()`, this
 * script's own stand-in is already the only implementation in scope. It never imports `vscode`
 * and never talks to a real extension host or Go server — the whole point of this tier (§4.2).
 */

import { buildPackedChunk } from '@kira/git-core/testing/packedChunk';
import type { PackedCommitChunk } from '@kira/git-ipc';
import { CONTRACT_VERSION } from '@kira/git-ipc';
import { encode, encodeStreamPayload } from '@kira/git-ipc/codec';

export const FAKE_REPO_ID = '/fake/repo';
export const FAKE_BRANCH = 'feature/example';
const FAKE_BASE = 'main';
export const FAKE_SHA = '1111111111111111111111111111111111111111';
const FAKE_SUBJECT = 'Add the example feature';
export const FAKE_FILE_PATH = 'src/example.ts';
// G-UX D3/D6 (items 3/6): a second file, a different extension, sorted AFTER `FAKE_FILE_PATH` in
// flat view's own path sort (`fileTreeModel.ts`'s `buildFlatList`: 'e' < 'z') — added purely so
// `file-tree-open.spec.ts` can compare two rows' seti icons/status letters without disturbing
// `openFileRow()`'s own existing "row index 0 is FAKE_FILE_PATH" assumption every other case here
// already depends on. `.json`, not `.md`: seti-icons' own `definitions.json` gives `.ts` and
// `.json` genuinely different colours (blue vs yellow) — `.md` shares `.ts`'s blue, which would
// make a colour-difference assertion fail for a reason that has nothing to do with this fixture.
export const FAKE_FILE_PATH_2 = 'src/zz-note.json';

// P75 §8: three review.files entries, one per ReviewFileStatus.kind — the Files pane's own
// tri-state checkbox test needs a `none`/`partial`/`full` row to check `:checked`/`:indeterminate`
// against, which the four pre-existing fixtures never needed. Basenames deliberately share no
// substring with one another — a `hasText` row filter on one must never also match another.
export const FAKE_REVIEW_FILE_NONE = 'src/pending.ts';
export const FAKE_REVIEW_FILE_PARTIAL = 'src/halfway.ts';
export const FAKE_REVIEW_FILE_FULL = 'src/done.ts';

function wrap(body: unknown): unknown {
  return encode({ version: CONTRACT_VERSION, body }, 'base64').payload;
}

function reviewPackedChunk(): PackedCommitChunk {
  return buildPackedChunk([{ sha: FAKE_SHA, subject: FAKE_SUBJECT }], { timestamp: 1_700_000_000 });
}

/** The scripted responses, each a ready-to-dispatch wire envelope (`{version, body}`) — built
 *  once, here, from real contract shapes, never assembled by the in-page script itself. */
function buildResponses(): {
  appInit: (id: number) => unknown;
  resolveBase: (id: number) => unknown;
  streamChunkThenEnd: (id: number) => readonly [unknown, unknown];
  commitDetail: (id: number) => unknown;
  openDiffOk: (id: number) => unknown;
  reviewFiles: (id: number) => unknown;
  openAllChangesOk: (id: number) => unknown;
  revealCommitOk: (id: number) => unknown;
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
    resolveBase: (id) =>
      wrap({
        t: 'res',
        id,
        ok: true,
        result: {
          branch: FAKE_BRANCH,
          base: FAKE_BASE,
          reason: 'defaultBranch',
          range: { kind: 'ready', commitCount: 1 },
          candidates: [],
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
        commits: reviewPackedChunk(),
      });
      return [wrap({ t: 'chunk', id, chunk }), wrap({ t: 'end', id })] as const;
    },
    commitDetail: (id) =>
      wrap({
        t: 'res',
        id,
        ok: true,
        result: {
          sha: FAKE_SHA,
          parents: [],
          author: { name: 'Fake Author', email: 'fake@example.com', timestamp: 1_700_000_000 },
          committer: { name: 'Fake Author', email: 'fake@example.com', timestamp: 1_700_000_000 },
          subject: FAKE_SUBJECT,
          body: '',
          trailers: [],
          signature: { status: 'N', signer: '' },
          decoration: [],
          parentIndex: 0,
          files: [
            {
              kind: 'modified',
              path: FAKE_FILE_PATH,
              originalPath: undefined,
              similarity: undefined,
              additions: 3,
              deletions: 1,
              isBinary: false,
            },
            {
              kind: 'added',
              path: FAKE_FILE_PATH_2,
              originalPath: undefined,
              similarity: undefined,
              additions: 5,
              deletions: 0,
              isBinary: false,
            },
          ],
        },
      }),
    // G21 D14: `editor.openDiff` — answered (trivially, `{}`) rather than left pending, so
    // `file-tree-open.spec.ts` can await the click/dblclick/Enter gesture it triggers and then
    // read back every recorded call's own `pinned` argument (`buildFakeHostInitScript`'s own
    // `window.__openDiffCalls`) — "which options argument was passed" is not observable any other
    // way (G21 F8's own wording).
    openDiffOk: (id) => wrap({ t: 'res', id, ok: true, result: {} }),
    // P75 §8: one entry per ReviewFileStatus.kind — the Files pane's checkbox test reads
    // `:checked`/`:indeterminate` off these three rows.
    reviewFiles: (id) =>
      wrap({
        t: 'res',
        id,
        ok: true,
        result: {
          branchTip: FAKE_SHA,
          mergeBase: FAKE_SHA,
          files: [
            {
              change: {
                kind: 'modified',
                path: FAKE_REVIEW_FILE_NONE,
                originalPath: undefined,
                similarity: undefined,
                additions: 2,
                deletions: 1,
                isBinary: false,
              },
              review: {
                kind: 'none',
                changedSinceReview: false,
                reviewedAt: undefined,
                reviewedAtSha: undefined,
              },
            },
            {
              change: {
                kind: 'modified',
                path: FAKE_REVIEW_FILE_PARTIAL,
                originalPath: undefined,
                similarity: undefined,
                additions: 4,
                deletions: 0,
                isBinary: false,
              },
              review: {
                kind: 'partial',
                changedSinceReview: false,
                reviewedAt: 1_700_000_000_000,
                reviewedAtSha: FAKE_SHA,
              },
            },
            {
              change: {
                kind: 'modified',
                path: FAKE_REVIEW_FILE_FULL,
                originalPath: undefined,
                similarity: undefined,
                additions: 1,
                deletions: 1,
                isBinary: false,
              },
              review: {
                kind: 'full',
                changedSinceReview: false,
                reviewedAt: 1_700_000_000_000,
                reviewedAtSha: FAKE_SHA,
              },
            },
          ],
        },
      }),
    // P75 §8: "Open all changes" on a collapsed row — a plausible, non-error outcome is all this
    // assertion needs; the exact numbers are not the point, the request/announcement are.
    openAllChangesOk: (id) =>
      wrap({ t: 'res', id, ok: true, result: { opened: 2, failed: 0, mode: 'tabs' } }),
    revealCommitOk: (id) => wrap({ t: 'res', id, ok: true, result: { revealed: true } }),
  };
}

/**
 * Builds the plain-JS string installed via `page.addInitScript`. Reads each incoming
 * `acquireVsCodeApi().postMessage(...)` call and, for the methods this fixture scripts,
 * dispatches the matching wire response(s) as a `window` `message` event — exactly the shape
 * `createVsCodeChannel`'s own `onMessage` (`webview/main.ts`) already listens for. Every other
 * method (`refs.list`, `review.comment.list`, `review.session.save`, …) is left unanswered — a
 * pending promise nothing in these specs' own assertions waits on, matching §4.2's own scope
 * (D10/D11a's DOM assertions never depend on any of them resolving).
 *
 * G21 D14: `editor.openDiff` is the exception — every call is both answered (`{}`, so
 * `openInEditor`'s own `await` resolves) and recorded onto `window.__openDiffCalls`, in arrival
 * order, so `file-tree-open.spec.ts` can read back exactly which `pinned` value each click/
 * dblclick/`Enter` gesture actually sent. P75 §8: `editor.openAllChanges`/`graph.revealCommit`
 * are answered and recorded the same way, onto `window.__openAllChangesCalls`/
 * `window.__revealCommitCalls`.
 */
export function buildFakeHostInitScript(): string {
  const responses = buildResponses();
  const data = {
    appInit: responses.appInit(0),
    resolveBase: responses.resolveBase(0),
    stream: responses.streamChunkThenEnd(0),
    commitDetail: responses.commitDetail(0),
    openDiffOk: responses.openDiffOk(0),
    reviewFiles: responses.reviewFiles(0),
    openAllChangesOk: responses.openAllChangesOk(0),
    revealCommitOk: responses.revealCommitOk(0),
  };
  // Each fixture above was built against a placeholder id (0); the in-page script below
  // substitutes the *real* request id (assigned by the client's own `nextId` counter) into a
  // fresh deep clone before dispatch, so a real client's own request/response id matching still
  // works despite these being precomputed once, here, statically.
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

      window.__openDiffCalls = [];
      // P75 §8: recorded the same way __openDiffCalls already is — arrival-order params for each
      // request, so a spec can await the gesture and read back exactly what host method fired.
      window.__openAllChangesCalls = [];
      window.__revealCommitCalls = [];

      window.acquireVsCodeApi = () => ({
        postMessage(message) {
          const body = message && message.body;
          if (!body) return;
          if (body.t === 'req' && body.method === 'app.init') {
            dispatch(withId(FIXTURES.appInit, body.id));
            return;
          }
          if (body.t === 'req' && body.method === 'review.resolveBase') {
            dispatch(withId(FIXTURES.resolveBase, body.id));
            return;
          }
          if (body.t === 'req' && body.method === 'commit.detail') {
            dispatch(withId(FIXTURES.commitDetail, body.id));
            return;
          }
          if (body.t === 'req' && body.method === 'editor.openDiff') {
            window.__openDiffCalls.push(body.params);
            dispatch(withId(FIXTURES.openDiffOk, body.id));
            return;
          }
          if (body.t === 'req' && body.method === 'review.files') {
            dispatch(withId(FIXTURES.reviewFiles, body.id));
            return;
          }
          if (body.t === 'req' && body.method === 'editor.openAllChanges') {
            window.__openAllChangesCalls.push(body.params);
            dispatch(withId(FIXTURES.openAllChangesOk, body.id));
            return;
          }
          if (body.t === 'req' && body.method === 'graph.revealCommit') {
            window.__revealCommitCalls.push(body.params);
            dispatch(withId(FIXTURES.revealCommitOk, body.id));
            return;
          }
          if (body.t === 'open' && body.method === 'graph.stream') {
            const [chunkEnvelope, endEnvelope] = FIXTURES.stream;
            dispatch(withId(chunkEnvelope, body.id));
            dispatch(withId(endEnvelope, body.id));
            return;
          }
          // Every other method (refs.list, review.comment.list, review.session.save/.load, …) is
          // deliberately left unanswered — see this file's own doc comment.
        },
        getState() {
          return undefined;
        },
        setState() {},
      });
    })();
  `;
}
