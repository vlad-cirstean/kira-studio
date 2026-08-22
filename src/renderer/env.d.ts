/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}

import type { KiraApi } from '@shared/protocol/ipc';

declare global {
  interface Window {
    kira: KiraApi;
  }
}
