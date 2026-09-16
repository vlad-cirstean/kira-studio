/**
 * P79 finding 4 — `link.openExternal` validates a commit message body's own URL
 * (`isValidExternalLinkUrl`, `linkUrl.ts`) before handing it to `browser.openExternal`, and never
 * reaches the Go server at all (unlike `pr.openExternal`). Mirrors `prOpenExternal.test.ts`'s own
 * "stub everything but the handler under test" shape.
 */

import { describe, expect, test } from 'bun:test';
import type { ConnectionManager } from './connection.ts';
import { createProxyHandlers } from './proxyHandlers.ts';

function buildHandlers(opened: string[]) {
  const notImplemented = (): never => {
    throw new Error('not implemented in this test');
  };
  const connection = {
    request: () => {
      throw new Error('link.openExternal must never reach the Go server');
    },
  } as unknown as ConnectionManager;
  return createProxyHandlers({
    connection,
    settings: notImplemented,
    // biome-ignore lint/suspicious/noExplicitAny: unused by link.openExternal, stubbed minimally.
    roots: {} as any,
    // biome-ignore lint/suspicious/noExplicitAny: unused by link.openExternal, stubbed minimally.
    clipboard: {} as any,
    // biome-ignore lint/suspicious/noExplicitAny: unused by link.openExternal, stubbed minimally.
    editor: {} as any,
    // biome-ignore lint/suspicious/noExplicitAny: unused by link.openExternal, stubbed minimally.
    logger: {} as any,
    // biome-ignore lint/suspicious/noExplicitAny: unused by link.openExternal, stubbed minimally.
    windows: {} as any,
    browser: { openExternal: async (u: string) => void opened.push(u) },
    isWorkspaceTrusted: () => true,
    revealReview: () => {},
    revealCommitInGraph: () => {},
    renderReviewComments: () => {},
    notifyCommentsMutated: () => {},
    refreshReviewMarking: () => {},
    notifyReviewMarked: () => {},
    // biome-ignore lint/suspicious/noExplicitAny: unused by link.openExternal, stubbed minimally.
    reviewSessionStore: {} as any,
  });
}

describe('link.openExternal', () => {
  test('opens a well-formed http(s) URL', async () => {
    const opened: string[] = [];
    const { requests } = buildHandlers(opened);
    // biome-ignore lint/suspicious/noExplicitAny: ctx is unused by link.openExternal.
    await requests['link.openExternal']({ url: 'https://example.com/page' }, {} as any);
    expect(opened).toEqual(['https://example.com/page']);
  });

  test('never opens a dangerous scheme', async () => {
    const opened: string[] = [];
    const { requests } = buildHandlers(opened);
    // biome-ignore lint/suspicious/noExplicitAny: ctx is unused by link.openExternal.
    await requests['link.openExternal']({ url: 'javascript:alert(1)' }, {} as any);
    expect(opened).toEqual([]);
  });
});
