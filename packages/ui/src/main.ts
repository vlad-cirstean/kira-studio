import type { HostKind, Transport } from "@kira-version/ipc";
import { createApp, type App as VueApp } from "vue";
import AppRoot from "./App.vue";
import type { ViewStateStore } from "./state/viewState.ts";
import "./icons/codicon.css";
import "./theme/vscode-tokens.css";
import "./theme/density.css";

export interface MountHandle {
  unmount(): void;
}

export interface MountOptions {
  readonly transport: Transport;
  readonly viewState: ViewStateStore;
  readonly host: HostKind;
}

/**
 * Mounts the app shell into `container`, wired to `transport` and `viewState`, told which
 * `host` it is running under. Hosts and the harness call this rather than each owning their
 * own bootstrap — the UI is mounted unchanged everywhere (§8.4), only these three pieces
 * differ. `viewState` is what P3 W9 adds: without it, the panel would have to keep
 * `retainContextWhenHidden` on to avoid losing scroll/selection/loaded-row state every time a
 * VS Code webview is hidden and recreated (§2.1) — this is a breaking change to the one
 * function every host and the harness call.
 */
export function mount(container: Element, opts: MountOptions): MountHandle {
  // §5.1 perf budgets are measured from navigation start (the implicit start of a
  // timeOrigin-relative measure); this marks the point the app's own bundle has parsed
  // and begun mounting. App.vue marks first-paint and layout-complete once mounted.
  performance.mark("kira:page-parsed");
  performance.measure("kira:page-parsed", undefined, "kira:page-parsed");

  const app: VueApp = createApp(AppRoot, { ...opts });
  app.mount(container);
  return {
    unmount(): void {
      app.unmount();
    },
  };
}
