import type { ServerHandlers } from '@kira/git-ipc';
import type { ConnectionManager } from '../connection.ts';
import { createProxyHandlers } from '../proxyHandlers.ts';

/**
 * `createProxyHandlers`'s own "stub everything but the handler under test" shape — shared by
 * `linkOpenExternal.test.ts` and `prOpenExternal.test.ts` (P107 I2-27), which differ only in
 * their own `connection` stub (what `pr.browserUrl` answers, or that `link.openExternal` must
 * never reach it at all) and which URLs land in their own `opened` array.
 */
export function buildStubProxyHandlers(
  connection: ConnectionManager,
  opened: string[],
): ServerHandlers {
  const notImplemented = (): never => {
    throw new Error('not implemented in this test');
  };
  return createProxyHandlers({
    connection,
    settings: notImplemented,
    // biome-ignore lint/suspicious/noExplicitAny: unused by the handler under test, stubbed minimally.
    roots: {} as any,
    // biome-ignore lint/suspicious/noExplicitAny: unused by the handler under test, stubbed minimally.
    clipboard: {} as any,
    // biome-ignore lint/suspicious/noExplicitAny: unused by the handler under test, stubbed minimally.
    editor: {} as any,
    // biome-ignore lint/suspicious/noExplicitAny: unused by the handler under test, stubbed minimally.
    logger: {} as any,
    // biome-ignore lint/suspicious/noExplicitAny: unused by the handler under test, stubbed minimally.
    windows: {} as any,
    browser: { openExternal: async (u: string) => void opened.push(u) },
    isWorkspaceTrusted: () => true,
    revealReview: () => {},
    revealCommitInGraph: () => {},
    renderReviewComments: () => {},
    notifyCommentsMutated: () => {},
    refreshReviewMarking: () => {},
    notifyReviewMarked: () => {},
    // biome-ignore lint/suspicious/noExplicitAny: unused by the handler under test, stubbed minimally.
    reviewSessionStore: {} as any,
  });
}
