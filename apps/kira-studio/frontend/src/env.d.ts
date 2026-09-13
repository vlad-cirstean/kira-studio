/// <reference types="vite/client" />

// vite.config.ts's `define` — true for `wails3 dev`'s dev server and the build:dev/build:test
// bundles, false everywhere else (P29 F1). Gates main.ts's window.__kira* debug-hook install.
declare const __KIRA_DEBUG_HOOKS__: boolean;

declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}
