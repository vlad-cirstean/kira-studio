/**
 * The Electron renderer's bootstrap (P3 W11) — the same shape as `host-vscode/src/webview/
 * main.ts`, minus the bootstrap JSON island: `renderer/index.html` is a static file Vite
 * processes once at build time (W13), not regenerated per-load the way VS Code's `html.ts`
 * rebuilds its document with a fresh nonce and CSP every time the panel opens — so `host` is a
 * compile-time literal here rather than something read out of the document. `window.kiraBridge`
 * is the surface `preload/index.ts` exposes over `contextBridge`; nothing here imports
 * `electron` (that module exists only in the main and preload contexts).
 */
import type { MessageChannelLike } from "@kira-version/ipc";
import { createRpcClient } from "@kira-version/ipc";
import { InMemoryViewStateStore, mount } from "@kira-version/ui";

interface KiraBridge {
  onPort(cb: () => void): void;
  postMessage(message: unknown, transfer?: readonly ArrayBuffer[]): void;
  onMessage(cb: (message: unknown) => void): () => void;
}

declare global {
  interface Window {
    readonly kiraBridge: KiraBridge;
  }
}

function createElectronChannel(bridge: KiraBridge): MessageChannelLike {
  return {
    post(message, transfer): void {
      bridge.postMessage(message, transfer);
    },
    onMessage(handler): () => void {
      return bridge.onMessage(handler);
    },
    close(): void {},
  };
}

const container = document.getElementById("app");
if (!container) throw new Error("renderer: #app container missing from renderer/index.html");

window.kiraBridge.onPort(() => {
  mount(container, {
    transport: createRpcClient(createElectronChannel(window.kiraBridge)),
    // P3 has no scenario where this window is unmounted and remounted within a session — a
    // `BrowserWindow` is not hidden/recreated the way a VS Code webview is — so there is
    // nothing real to rehydrate yet. A `Storage`-backed store (docs/plans/P3.md's W9 text:
    // "an Electron one over the Storage port through the bridge") is the natural next step
    // once a reload or relaunch flow gives it something to prove; mirrors host-vscode's own
    // Storage-port omission (W10).
    viewState: new InMemoryViewStateStore(),
    host: "electron",
  });
});
