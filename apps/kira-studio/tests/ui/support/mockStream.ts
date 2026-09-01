import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import type { PortSnapshot } from '../../ipc/support/types';

export interface SeenPortRequest {
  op: string;
  payload: unknown;
}

export interface MockStreamHandle {
  /** Every `PortRequest` the UI actually issued, in order — ported from
   *  `tests/ipc/support/mockPort.ts`'s `MockPortHandle.ops()` (P50 D7). */
  ops(): Promise<SeenPortRequest[]>;
}

// Read once, not per call: `installMockStream` runs at least once per test. `bun run format`
// (biome) reformats mockStreamBrowser.js like any other tracked file, including appending a
// trailing `;` after its top-level expression statement — stripped here so wrapping it in a call
// (`(${BROWSER_SCRIPT})(...)`, below) stays valid regardless of which way the formatter last
// touched it.
const BROWSER_SCRIPT = readFileSync(resolve(__dirname, 'mockStreamBrowser.js'), 'utf8')
  .trim()
  .replace(/;$/, '');

/**
 * Replaces the bulk-data transport from the renderer side (P57 D14) by installing
 * `window._wails.streamFactory` — `@wailsio/runtime`'s `stream.js` calls this synchronously
 * inside `Stream(name)` if it exists, in preference to opening a real connection
 * (`stream.js`: *"Server builds install a factory returning a real WebSocket… both objects present
 * the same interface, so nothing above this line cares which it is"*). `bridge/port.ts` calls
 * `JSONStream('engine')` at its own module scope, so this must be installed via
 * `page.addInitScript` — before any page script runs, on every navigation — never `page.evaluate`,
 * which would race the app's own module graph.
 *
 * The actual logic lives in `mockStreamBrowser.js`, a plain, uncompiled JS file injected as a
 * **string**, not `page.addInitScript(fn, arg)` — see that file's own doc comment for why a typed
 * function does not survive the round trip here (a `keepNames` artefact common to every
 * esbuild-based TS loader this repo's tooling runs under).
 */
export async function installMockStream(
  page: Page,
  snapshots: readonly PortSnapshot[],
): Promise<MockStreamHandle> {
  await page.addInitScript(`(${BROWSER_SCRIPT})(${JSON.stringify(snapshots)});`);

  return {
    ops: () =>
      page.evaluate(
        () => (globalThis as unknown as { __kiraStreamSeen: SeenPortRequest[] }).__kiraStreamSeen,
      ),
  };
}
