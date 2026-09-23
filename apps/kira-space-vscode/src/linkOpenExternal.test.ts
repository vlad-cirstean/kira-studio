/**
 * P79 finding 4 — `link.openExternal` validates a commit message body's own URL
 * (`isValidExternalLinkUrl`, `linkUrl.ts`) before handing it to `browser.openExternal`, and never
 * reaches the Go server at all (unlike `pr.openExternal`). Mirrors `prOpenExternal.test.ts`'s own
 * "stub everything but the handler under test" shape.
 */

import { describe, expect, test } from 'bun:test';
import type { ConnectionManager } from './connection.ts';
import { buildStubProxyHandlers } from './testing/stubHost.ts';

function buildHandlers(opened: string[]) {
  const connection = {
    request: () => {
      throw new Error('link.openExternal must never reach the Go server');
    },
  } as unknown as ConnectionManager;
  return buildStubProxyHandlers(connection, opened);
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
