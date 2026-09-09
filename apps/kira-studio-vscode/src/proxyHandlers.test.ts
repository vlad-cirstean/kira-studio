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
    // biome-ignore lint/suspicious/noExplicitAny: unused by review.session.*, stubbed minimally.
    windows: {} as any,
    isWorkspaceTrusted: () => true,
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

interface RecordedOpenAllChanges {
  readonly title: string;
  readonly files: readonly { left: DocumentRef; right: DocumentRef; resource: string }[];
}

function buildOpenDiffHandlers(connection: ConnectionManager) {
  const recorded: RecordedOpenDiff[] = [];
  const recordedAllChanges: RecordedOpenAllChanges[] = [];
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
      openAllChanges: async (req: RecordedOpenAllChanges) => {
        recordedAllChanges.push(req);
        return { opened: req.files.length, failed: 0, mode: 'multiDiff' as const };
      },
      reveal: notImplemented,
      resolveConflict: notImplemented,
      // biome-ignore lint/suspicious/noExplicitAny: structurally satisfies EditorIntegration.
    } as any,
    // biome-ignore lint/suspicious/noExplicitAny: unused here, stubbed minimally.
    logger: {} as any,
    // biome-ignore lint/suspicious/noExplicitAny: unused by review.session.*, stubbed minimally.
    windows: {} as any,
    isWorkspaceTrusted: () => true,
    revealReview: () => {},
    renderReviewComments: () => {},
    notifyCommentsMutated: () => {},
    refreshReviewMarking: () => {},
    notifyReviewMarked: () => {},
    reviewSessionStore: { get: () => undefined, update: async () => {} },
  });
  return { requests, recorded, recordedAllChanges };
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

describe('editor.openAllChanges — G21 D8a', () => {
  test('composes N resource triples from one commit.detail call and forwards the port result', async () => {
    const detail = detailFor('sha1', [
      fileChange('a.ts'),
      fileChange('b.ts', 'added'),
      fileChange('c.ts', 'deleted'),
    ]);
    let detailRequests = 0;
    const connection = {
      request: async (method: string, params: unknown) => {
        if (method !== 'commit.detail') throw new Error(`unexpected method ${method}`);
        detailRequests++;
        const { repoId, sha } = params as { repoId: string; sha: string };
        if (`${repoId}:${sha}` !== 'r1:sha1') throw new Error('no fixture');
        return detail;
      },
      // biome-ignore lint/suspicious/noExplicitAny: cast to the concrete class for this fake's shape.
    } as any as ConnectionManager;
    const { requests, recordedAllChanges } = buildOpenDiffHandlers(connection);

    const result = await requests['editor.openAllChanges'](
      { repoId: 'r1', sha: 'sha1' },
      // biome-ignore lint/suspicious/noExplicitAny: only `signal` is read.
      { signal: new AbortController().signal } as any,
    );

    // One commit.detail round trip for all three files, not three (D8a's own "collapsing N
    // round trips into one").
    expect(detailRequests).toBe(1);
    expect(recordedAllChanges).toHaveLength(1);
    const request = recordedAllChanges[0];
    expect(request?.files).toHaveLength(3);
    expect(request?.title).toContain('sha1'.slice(0, 7));
    // No repo root known to this fake (no editor.resolveConflict-style repo.open call was ever
    // made) — resource falls back to the bare repo-relative path, exactly as the handler's own
    // `root ? join(root, change.path) : change.path` documents.
    expect(request?.files.map((f) => f.resource)).toEqual(['a.ts', 'b.ts', 'c.ts']);
    // An added file has no base side; a deleted file has no head side — the same derivation
    // editor.openDiff's own handler uses (documentRefsFor), never disagreeing about which side
    // is `empty`.
    expect(request?.files[1]?.left).toEqual({ kind: 'empty', label: 'b.ts' });
    expect(request?.files[2]?.right).toEqual({ kind: 'empty', label: 'c.ts' });
    expect(result).toEqual({ opened: 3, failed: 0, mode: 'multiDiff' });
  });
});
