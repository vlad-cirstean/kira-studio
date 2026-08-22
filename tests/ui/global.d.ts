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
  }
}
