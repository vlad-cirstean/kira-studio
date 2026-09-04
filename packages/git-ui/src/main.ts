import type { HostKind, Transport } from '@kira/git-ipc';
import { createApp, type App as VueApp } from 'vue';
import AppRoot from './App.vue';
import type { ViewStateStore } from './state/viewState';
import './icons/codicon.css';
import './theme/tokens.css';
import './theme/density.css';

export interface MountHandle {
  unmount(): void;
}

export interface MountOptions {
  readonly transport: Transport;
  readonly viewState: ViewStateStore;
  readonly host: HostKind;
}

/**
 * Mounts the app shell into `container`, wired to `transport` and `viewState`, told which `host`
 * it is running under. **This is the entire surface a host implements against**: the host and the
 * harness both call this one function, the UI bundle is mounted unchanged in either, and only
 * these three arguments differ. `viewState` persists scroll, selection, column widths and how many
 * pages were loaded, so a mode switch that unmounts and remounts Git mode restores rather than
 * resets.
 */
export function mount(container: Element, opts: MountOptions): MountHandle {
  // §5.1 perf budgets are measured from navigation start (the implicit start of a
  // timeOrigin-relative measure); this marks the point the app's own bundle has parsed
  // and begun mounting. App.vue marks first-paint and layout-complete once mounted.
  performance.mark('kira:page-parsed');
  performance.measure('kira:page-parsed', undefined, 'kira:page-parsed');

  const app: VueApp = createApp(AppRoot, { ...opts });
  app.mount(container);
  return {
    unmount(): void {
      app.unmount();
    },
  };
}
