import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';

/** One scripted request/stream-open response for the "git" stream's real frame protocol —
 *  D5's real-runtime tier, the mockRuntime.ts/mockStream.ts sibling for the second named stream
 *  (§3). `method`/`params` key a request the same way `PortSnapshot`'s `op`/`payload` do; `params`
 *  omitted matches any params for that method (the common case — every P1 request either takes no
 *  params or is exercised with exactly one args shape per spec). */
export interface GitStreamRequestSnapshot {
  method: string;
  params?: unknown;
  response?: unknown;
  error?: { code: string; message: string };
}

/** One scripted `graph.stream` (or a later phase's own stream key) open — P1 has exactly one
 *  stream key, always ending immediately with zero chunks; `error` scripts a failed open instead
 *  (an unknown repoId, say). */
export interface GitStreamStreamSnapshot {
  method: string;
  error?: { code: string; message: string };
}

/** An unsolicited event fired once the mock socket is open — proves transport.ts's own `on()`
 *  path over the real Wails runtime, the same "an event crossing" §7 exit criterion
 *  gitstream_internal_test.go already proves Go-side. */
export interface GitStreamEventSnapshot {
  method: string;
  payload: unknown;
  delayMs?: number;
}

export interface MockGitStreamHandle {
  /** Every request/stream-open the UI actually issued over the git stream, in order. */
  requests(): Promise<Array<{ method: string; params: unknown }>>;
}

const BROWSER_SCRIPT = readFileSync(resolve(__dirname, 'mockGitStreamBrowser.js'), 'utf8')
  .trim()
  .replace(/;$/, '');

/**
 * Installs the "git" stream's own mock socket, composing with (never replacing) whatever
 * `window._wails.streamFactory` mockStream.ts already installed for 'engine' — see
 * mockGitStreamBrowser.js's own doc comment for why composition, not installation order alone,
 * is what makes that safe. Call this *after* `installMockStream` in a test's own setup, mirroring
 * that ordering requirement.
 */
export async function installMockGitStream(
  page: Page,
  scenario: {
    requests?: readonly GitStreamRequestSnapshot[];
    streams?: readonly GitStreamStreamSnapshot[];
    events?: readonly GitStreamEventSnapshot[];
  },
): Promise<MockGitStreamHandle> {
  const init = {
    requests: scenario.requests ?? [],
    streams: scenario.streams ?? [],
    events: scenario.events ?? [],
  };
  await page.addInitScript(`(${BROWSER_SCRIPT})(${JSON.stringify(init)});`);

  return {
    requests: () =>
      page.evaluate(
        () =>
          (
            globalThis as unknown as {
              __kiraGitStreamSeen: Array<{ method: string; params: unknown }>;
            }
          ).__kiraGitStreamSeen,
      ),
  };
}
