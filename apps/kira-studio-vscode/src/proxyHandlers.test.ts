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
