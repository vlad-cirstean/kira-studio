/**
 * G32 round-3 performance review, finding #2's own regression fixture: a variant of
 * `fakeReviewHost.ts` (same wrap/encode approach, same real `@kira/git-ipc/codec`) that streams
 * MANY synthetic commits in one `graph.stream` chunk instead of one — the only way to actually
 * exercise `ReviewView.vue`'s own render cap (`renderCap`/`REVIEW_ROW_RENDER_CAP`, 500) in a real
 * browser. Kept separate from `fakeReviewHost.ts` itself (rather than parameterizing it) so this
 * one spec's own needs never risk perturbing that file's own already-passing, narrowly-scoped
 * fixture used elsewhere.
 */

import type { PackedCommitChunk } from '@kira/git-ipc';
import { CONTRACT_VERSION } from '@kira/git-ipc';
import { encode, encodeStreamPayload } from '@kira/git-ipc/codec';

export const MANY_REPO_ID = '/fake/many-repo';
export const MANY_BRANCH = 'feature/many';
export const MANY_BASE = 'main';

function shaFor(index: number): string {
  return index.toString(16).padStart(40, '0');
}

function wrap(body: unknown): unknown {
  return encode({ version: CONTRACT_VERSION, body }, 'base64').payload;
}

function buildManyPackedChunk(n: number): PackedCommitChunk {
  const shaBytes = Buffer.concat(
    Array.from({ length: n }, (_, i) => Buffer.from(shaFor(i), 'hex')),
  );
  const subjects = Array.from({ length: n }, (_, i) => `Commit ${i}`);
  const subjectBytes = Buffer.from(subjects.join(''), 'utf8');
  const subjectOffsets: number[] = [0];
  let offset = 0;
  for (const s of subjects) {
    offset += Buffer.byteLength(s, 'utf8');
    subjectOffsets.push(offset);
  }
  const timestamp = 1_700_000_000;
  const parentOffsets = Array.from({ length: n + 1 }, () => 0); // every commit is a synthetic root — no parents.
  const identityIds: number[] = [];
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    identityIds.push(0, 1, 0, 1);
    times.push(timestamp + i, timestamp + i);
  }
  return {
    from: 0,
    to: n,
    shaWidthBytes: 20,
    shas: shaBytes.buffer.slice(shaBytes.byteOffset, shaBytes.byteOffset + shaBytes.byteLength),
    parentOffsets: Uint32Array.from(parentOffsets).buffer,
    parentShas: new ArrayBuffer(0),
    identityIds: Uint32Array.from(identityIds).buffer,
    times: Uint32Array.from(times).buffer,
    subjectBytes: subjectBytes.buffer.slice(
      subjectBytes.byteOffset,
      subjectBytes.byteOffset + subjectBytes.byteLength,
    ),
    subjectOffsets: Uint32Array.from(subjectOffsets).buffer,
    dictionaryBase: 0,
    dictionary: ['Fake Author', 'fake@example.com'],
    decorations: [],
  };
}

/** Builds the `page.addInitScript` string for a review target with `n` synthetic commits, all
 *  delivered as one `graph.stream` chunk (`exhausted: true` — no "Load more" involved; this
 *  fixture is about the render cap, not paging, which PERF1's own Go-side tests already cover). */
export function buildManyCommitsInitScript(n: number): string {
  const appInit = wrap({
    t: 'res',
    id: 0,
    ok: true,
    result: {
      host: 'vscode',
      contractVersion: CONTRACT_VERSION,
      settings: { 'workbench.tree.indent': 8 },
      git: { kind: 'ok', path: '/usr/bin/git', version: '2.42.0' },
      capabilities: { openInEditor: true, goToFile: true, clipboard: true, resolveConflict: true },
    },
  });
  const resolveBase = wrap({
    t: 'res',
    id: 0,
    ok: true,
    result: {
      branch: MANY_BRANCH,
      base: MANY_BASE,
      reason: 'defaultBranch',
      range: { kind: 'ready', commitCount: n },
      candidates: [],
    },
  });
  const chunk = encodeStreamPayload('graph.stream', {
    repoId: MANY_REPO_ID,
    seq: 0,
    from: 0,
    to: n,
    source: 'git',
    remaining: 0,
    exhausted: true,
    commits: buildManyPackedChunk(n),
  });
  const streamChunk = wrap({ t: 'chunk', id: 0, chunk });
  const streamEnd = wrap({ t: 'end', id: 0 });
  const fixtureJson = JSON.stringify({ appInit, resolveBase, streamChunk, streamEnd });

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
          if (body.t === 'req' && body.method === 'review.resolveBase') {
            dispatch(withId(FIXTURES.resolveBase, body.id));
            return;
          }
          if (body.t === 'open' && body.method === 'graph.stream') {
            dispatch(withId(FIXTURES.streamChunk, body.id));
            dispatch(withId(FIXTURES.streamEnd, body.id));
            return;
          }
          // Every other method deliberately left unanswered, same as fakeReviewHost.ts.
        },
        getState() {
          return undefined;
        },
        setState() {},
      });
    })();
  `;
}
