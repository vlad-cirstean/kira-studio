/**
 * P79 finding 3 — `pr.openExternal` re-validates `pr.browserUrl`'s answer (`isValidPrBrowserUrl`,
 * `prUrl.ts`) before handing it to `browser.openExternal`. Mirrors `proxyHandlers.test.ts`'s own
 * "stub everything but the handler under test" shape, in its own file since that one's doc
 * comment scopes it to `review.session.*` alone.
 */

import { describe, expect, test } from 'bun:test';
import type { ConnectionManager } from './connection.ts';
import { createProxyHandlers } from './proxyHandlers.ts';

function buildHandlers(url: string | null, opened: string[]) {
  const notImplemented = (): never => {
    throw new Error('not implemented in this test');
  };
  const connection = {
    request: async () => ({ url }),
  } as unknown as ConnectionManager;
  return createProxyHandlers({
    connection,
    settings: notImplemented,
    // biome-ignore lint/suspicious/noExplicitAny: unused by pr.openExternal, stubbed minimally.
    roots: {} as any,
    // biome-ignore lint/suspicious/noExplicitAny: unused by pr.openExternal, stubbed minimally.
    clipboard: {} as any,
    // biome-ignore lint/suspicious/noExplicitAny: unused by pr.openExternal, stubbed minimally.
    editor: {} as any,
    // biome-ignore lint/suspicious/noExplicitAny: unused by pr.openExternal, stubbed minimally.
    logger: {} as any,
    // biome-ignore lint/suspicious/noExplicitAny: unused by pr.openExternal, stubbed minimally.
    windows: {} as any,
    browser: { openExternal: async (u: string) => void opened.push(u) },
    isWorkspaceTrusted: () => true,
    revealReview: () => {},
    revealCommitInGraph: () => {},
    renderReviewComments: () => {},
    notifyCommentsMutated: () => {},
    refreshReviewMarking: () => {},
    notifyReviewMarked: () => {},
    // biome-ignore lint/suspicious/noExplicitAny: unused by pr.openExternal, stubbed minimally.
    reviewSessionStore: {} as any,
  });
}

describe('pr.openExternal', () => {
  test('opens a well-formed PR URL', async () => {
    const opened: string[] = [];
    const { requests } = buildHandlers('https://github.com/owner/repo/pull/42', opened);
    // biome-ignore lint/suspicious/noExplicitAny: ctx is unused by pr.openExternal.
    await requests['pr.openExternal']({ repoId: 'r1', number: 42 }, {} as any);
    expect(opened).toEqual(['https://github.com/owner/repo/pull/42']);
  });

  test('never opens when pr.browserUrl answers null', async () => {
    const opened: string[] = [];
    const { requests } = buildHandlers(null, opened);
    // biome-ignore lint/suspicious/noExplicitAny: ctx is unused by pr.openExternal.
    await requests['pr.openExternal']({ repoId: 'r1', number: 42 }, {} as any);
    expect(opened).toEqual([]);
  });

  test('never opens a malformed URL even if the socket answers one', async () => {
    const opened: string[] = [];
    const { requests } = buildHandlers('javascript:alert(1)', opened);
    // biome-ignore lint/suspicious/noExplicitAny: ctx is unused by pr.openExternal.
    await requests['pr.openExternal']({ repoId: 'r1', number: 42 }, {} as any);
    expect(opened).toEqual([]);
  });
});
