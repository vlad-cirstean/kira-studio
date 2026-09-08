/**
 * G19 D11b — `review.session.save`/`.load`'s own round trip, TTL, and clear-on-null behaviour.
 * `proxyHandlers.ts` never imports `vscode` (its own doc comment); this test keeps that true on
 * its own side too — `ReviewSessionStore` is satisfied here by a plain, in-memory `Map`-backed
 * stub (matching this file's own doc comment on why `ReviewSessionStore` is a narrow structural
 * type, not `vscode.Memento` itself), never a real `vscode` import. Every other request this
 * phase does not touch is stubbed to throw if ever called — this file only exercises the two new
 * handlers.
 */

import { describe, expect, test } from 'bun:test';
import type { DocumentRef, FileChange } from '@kira/git-core';
import type { ConnectionManager } from './connection.ts';
import { createProxyHandlers, type ReviewSessionStore } from './proxyHandlers.ts';

function fakeStore(): ReviewSessionStore {
  const backing = new Map<string, unknown>();
  return {
    get: <T>(key: string): T | undefined => backing.get(key) as T | undefined,
    update: async (key: string, value: unknown): Promise<void> => {
      // Mirrors VS Code's own Memento: JSON serialization drops `undefined`-valued properties,
      // which is exactly what review.session.save relies on to make `session: null` actually
      // clear a repoId's own entry rather than leaving it present-but-undefined.
      backing.set(key, JSON.parse(JSON.stringify(value)));
    },
  };
}

function buildHandlers(reviewSessionStore: ReviewSessionStore) {
  const notImplemented = (): never => {
    throw new Error('not implemented in this test');
  };
  return createProxyHandlers({
    connection: {} as unknown as ConnectionManager,
    settings: notImplemented,
    // biome-ignore lint/suspicious/noExplicitAny: unused by review.session.*, stubbed minimally.
    roots: {} as any,
    // biome-ignore lint/suspicious/noExplicitAny: unused by review.session.*, stubbed minimally.
    dialogs: {} as any,
    // biome-ignore lint/suspicious/noExplicitAny: unused by review.session.*, stubbed minimally.
    clipboard: {} as any,
    // biome-ignore lint/suspicious/noExplicitAny: unused by review.session.*, stubbed minimally.
    editor: {} as any,
    // biome-ignore lint/suspicious/noExplicitAny: unused by review.session.*, stubbed minimally.
    logger: {} as any,
    revealReview: () => {},
    renderReviewComments: () => {},
    notifyCommentsMutated: () => {},
    refreshReviewMarking: () => {},
    notifyReviewMarked: () => {},
    reviewSessionStore,
  });
}

const SNAPSHOT = {
  branch: 'feature/login',
  baseOverride: null,
  pane: 'commits' as const,
  listMode: 'tree' as const,
  filter: '',
  diffMode: 'sinceReview' as const,
};

describe('review.session.save/.load', () => {
  test('a save then a load round-trips exactly', async () => {
    const { requests } = buildHandlers(fakeStore());
    const save = requests['review.session.save'];
    const load = requests['review.session.load'];
    // biome-ignore lint/suspicious/noExplicitAny: ctx is unused by either handler.
    await save({ repoId: 'r1', session: SNAPSHOT }, {} as any);
    // biome-ignore lint/suspicious/noExplicitAny: ctx is unused by either handler.
    const result = await load({ repoId: 'r1' }, {} as any);
    expect(result).toEqual({ session: SNAPSHOT });
  });

  test('a different repoId never sees another repo’s saved session', async () => {
    const store = fakeStore();
    const { requests } = buildHandlers(store);
    // biome-ignore lint/suspicious/noExplicitAny: ctx is unused by either handler.
    await requests['review.session.save']({ repoId: 'r1', session: SNAPSHOT }, {} as any);
    // biome-ignore lint/suspicious/noExplicitAny: ctx is unused by either handler.
    const result = await requests['review.session.load']({ repoId: 'r2' }, {} as any);
    expect(result).toEqual({ session: null });
  });

  test('session: null clears a previously-saved entry', async () => {
    const store = fakeStore();
    const { requests } = buildHandlers(store);
    // biome-ignore lint/suspicious/noExplicitAny: ctx is unused by either handler.
    await requests['review.session.save']({ repoId: 'r1', session: SNAPSHOT }, {} as any);
    // biome-ignore lint/suspicious/noExplicitAny: ctx is unused by either handler.
    await requests['review.session.save']({ repoId: 'r1', session: null }, {} as any);
    // biome-ignore lint/suspicious/noExplicitAny: ctx is unused by either handler.
    const result = await requests['review.session.load']({ repoId: 'r1' }, {} as any);
    expect(result).toEqual({ session: null });
  });

  test('a load past the 14-day TTL returns {session: null}, not the stale snapshot', async () => {
    const store = fakeStore();
    const { requests } = buildHandlers(store);
    const fifteenDaysAgo = Date.now() - 15 * 24 * 60 * 60 * 1000;
    await store.update('kiraVersion.review.session', {
      r1: { ...SNAPSHOT, savedAt: fifteenDaysAgo },
    });
    // biome-ignore lint/suspicious/noExplicitAny: ctx is unused by either handler.
    const result = await requests['review.session.load']({ repoId: 'r1' }, {} as any);
    expect(result).toEqual({ session: null });
  });

  test('a load just under the 14-day TTL still resumes', async () => {
    const store = fakeStore();
    const { requests } = buildHandlers(store);
    const thirteenDaysAgo = Date.now() - 13 * 24 * 60 * 60 * 1000;
    await store.update('kiraVersion.review.session', {
      r1: { ...SNAPSHOT, savedAt: thirteenDaysAgo },
    });
    // biome-ignore lint/suspicious/noExplicitAny: ctx is unused by either handler.
    const result = await requests['review.session.load']({ repoId: 'r1' }, {} as any);
    expect(result).toEqual({ session: SNAPSHOT });
  });

  test('loading a repoId that was never saved returns {session: null}', async () => {
    const { requests } = buildHandlers(fakeStore());
    // biome-ignore lint/suspicious/noExplicitAny: ctx is unused by either handler.
    const result = await requests['review.session.load']({ repoId: 'never-saved' }, {} as any);
    expect(result).toEqual({ session: null });
  });
});

// ---------------------------------------------------------------------------------------
// G21 D12/D13: editor.openDiff — the fallbackSha retry (D12, the stash-untracked-file case)
// and pinned reaching the editor port unchanged (D13).
// ---------------------------------------------------------------------------------------

function fileChange(path: string, kind: FileChange['kind'] = 'modified'): FileChange {
  return {
    kind,
    path,
    originalPath: undefined,
    similarity: undefined,
    additions: 1,
    deletions: 1,
    isBinary: false,
  };
}

/** A minimal commit.detail response — only the fields editor.openDiff's own handler reads. */
function detailFor(sha: string, files: readonly FileChange[], parents: readonly string[] = ['p1']) {
  return {
    sha,
    parents,
    author: { name: 'a', email: 'a@example.com', timestamp: 0 },
    committer: { name: 'a', email: 'a@example.com', timestamp: 0 },
    subject: 'subject',
    body: '',
    trailers: [],
    signature: { status: 'N' as const, signer: '' },
    decoration: [],
    parentIndex: 0,
    files,
  };
}

interface RecordedOpenDiff {
  readonly left: DocumentRef;
  readonly right: DocumentRef;
  readonly title: string;
  readonly pinned: boolean;
}

function fakeConnectionServing(
  detailsByRepoAndSha: Record<string, ReturnType<typeof detailFor>>,
): ConnectionManager {
  return {
    request: async (method: string, params: unknown) => {
      if (method !== 'commit.detail') throw new Error(`unexpected method ${method}`);
      const { repoId, sha } = params as { repoId: string; sha: string };
      const detail = detailsByRepoAndSha[`${repoId}:${sha}`];
      if (!detail) throw new Error(`no commit.detail fixture for ${repoId}:${sha}`);
      return detail;
    },
    // biome-ignore lint/suspicious/noExplicitAny: cast to the concrete class for this fake's shape.
  } as any as ConnectionManager;
}

function buildOpenDiffHandlers(connection: ConnectionManager) {
  const recorded: RecordedOpenDiff[] = [];
  const notImplemented = (): never => {
    throw new Error('not implemented in this test');
  };
  const { requests } = createProxyHandlers({
    connection,
    settings: notImplemented,
    // biome-ignore lint/suspicious/noExplicitAny: unused here, stubbed minimally.
    roots: {} as any,
    // biome-ignore lint/suspicious/noExplicitAny: unused here, stubbed minimally.
    dialogs: {} as any,
    // biome-ignore lint/suspicious/noExplicitAny: unused here, stubbed minimally.
    clipboard: {} as any,
    editor: {
      capabilities: { openInEditor: true, goToFile: true, resolveConflict: true },
      registerVirtualDocuments: () => ({ dispose: () => {} }),
      openDiff: async (req: RecordedOpenDiff) => {
        recorded.push(req);
      },
      reveal: notImplemented,
      resolveConflict: notImplemented,
      // biome-ignore lint/suspicious/noExplicitAny: structurally satisfies EditorIntegration.
    } as any,
    // biome-ignore lint/suspicious/noExplicitAny: unused here, stubbed minimally.
    logger: {} as any,
    revealReview: () => {},
    renderReviewComments: () => {},
    notifyCommentsMutated: () => {},
    refreshReviewMarking: () => {},
    notifyReviewMarked: () => {},
    reviewSessionStore: { get: () => undefined, update: async () => {} },
  });
  return { requests, recorded };
}

describe('editor.openDiff — G21 D12 fallbackSha / D13 pinned', () => {
  test('pinned: true reaches the editor port as pinned: true', async () => {
    const connection = fakeConnectionServing({
      'r1:sha1': detailFor('sha1', [fileChange('a.ts')]),
    });
    const { requests, recorded } = buildOpenDiffHandlers(connection);
    await requests['editor.openDiff']({ repoId: 'r1', sha: 'sha1', path: 'a.ts', pinned: true }, {
      signal: new AbortController().signal,
      // biome-ignore lint/suspicious/noExplicitAny: only `signal` is read.
    } as any);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.pinned).toBe(true);
  });

  test('pinned: false (or omitted) reaches the editor port as pinned: false', async () => {
    const connection = fakeConnectionServing({
      'r1:sha1': detailFor('sha1', [fileChange('a.ts')]),
    });
    const { requests, recorded } = buildOpenDiffHandlers(connection);
    await requests['editor.openDiff']({ repoId: 'r1', sha: 'sha1', path: 'a.ts' }, {
      signal: new AbortController().signal,
      // biome-ignore lint/suspicious/noExplicitAny: only `signal` is read.
    } as any);
    expect(recorded[0]?.pinned).toBe(false);
  });

  test('a path missing from sha but present via fallbackSha retries and succeeds', async () => {
    // F12's own stash case: an untracked file lives only in the stash's third parent.
    const connection = fakeConnectionServing({
      'r1:stashSha': detailFor('stashSha', [fileChange('tracked.ts')]),
      'r1:untrackedSha': detailFor('untrackedSha', [fileChange('untracked.ts', 'added')]),
    });
    const { requests, recorded } = buildOpenDiffHandlers(connection);
    await requests['editor.openDiff'](
      {
        repoId: 'r1',
        sha: 'stashSha',
        path: 'untracked.ts',
        fallbackSha: 'untrackedSha',
        pinned: true,
      },
      // biome-ignore lint/suspicious/noExplicitAny: only `signal` is read.
      { signal: new AbortController().signal } as any,
    );
    expect(recorded).toHaveLength(1);
    // The right-hand side is addressed against the sha that actually had the file.
    expect(recorded[0]?.right).toMatchObject({ kind: 'virtual' });
    const right = recorded[0]?.right;
    if (right?.kind === 'virtual') expect(right.key).toContain('untrackedSha');
  });

  test('a path missing everywhere, with no fallbackSha, throws exactly as before', async () => {
    const connection = fakeConnectionServing({
      'r1:sha1': detailFor('sha1', [fileChange('a.ts')]),
    });
    const { requests } = buildOpenDiffHandlers(connection);
    await expect(
      requests['editor.openDiff'](
        { repoId: 'r1', sha: 'sha1', path: 'missing.ts', pinned: true },
        // biome-ignore lint/suspicious/noExplicitAny: only `signal` is read.
        { signal: new AbortController().signal } as any,
      ),
    ).rejects.toThrow(/is not one of commit sha1's changed files/);
  });

  test('a path missing from both sha and fallbackSha throws, naming the original sha', async () => {
    const connection = fakeConnectionServing({
      'r1:stashSha': detailFor('stashSha', [fileChange('tracked.ts')]),
      'r1:untrackedSha': detailFor('untrackedSha', [fileChange('other.ts', 'added')]),
    });
    const { requests } = buildOpenDiffHandlers(connection);
    await expect(
      requests['editor.openDiff'](
        {
          repoId: 'r1',
          sha: 'stashSha',
          path: 'nowhere.ts',
          fallbackSha: 'untrackedSha',
          pinned: true,
        },
        // biome-ignore lint/suspicious/noExplicitAny: only `signal` is read.
        { signal: new AbortController().signal } as any,
      ),
    ).rejects.toThrow(/is not one of commit stashSha's changed files/);
  });
});
