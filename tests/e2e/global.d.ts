import type { CacheStats, CountRequestWire, CountResponse } from '@shared/protocol/data-ops';
import type { KiraApi } from '@shared/protocol/ipc';

// Playwright's `page.evaluate()` callbacks run in the renderer's real global scope, so `window`
// there does carry `kira` (contextBridge, src/preload/index.ts). fixtures.ts names the Playwright
// Page fixture `window`, which would lexically shadow that DOM global inside any evaluate
// callback written in the same scope — specs in this directory therefore bind it to a local
// `page` instead, so a bare `window` inside an evaluate callback is never shadowed. This augments
// the ambient `Window` interface so `window.kira` typechecks inside those callbacks.
declare global {
  interface Window {
    kira: KiraApi;
    /** Playwright-only hook (src/renderer/main.ts) — the exact §2.2 retained-bytes figure. */
    __kiraGridRetainedBytes?: () => number;
    /** Playwright-only hook (src/renderer/main.ts, D5) — the sum across all five page stores. */
    __kiraRetainedBytes?: () => number;
    /** Playwright-only hook (src/renderer/main.ts) — drives `data.count()` directly. */
    __kiraCount?: (req: CountRequestWire) => Promise<CountResponse>;
    /** Playwright-only hook (src/renderer/main.ts) — reads L2/L3 cache stats directly. */
    __kiraCacheStats?: () => Promise<CacheStats>;
    /** Playwright-only hook (src/renderer/main.ts, D6) — the tree's live connection ids. */
    __kiraTreeConnectionIds?: () => string[];
  }
}
