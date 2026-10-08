import { defineStore } from 'pinia';

export type ModelKind = 'semantic' | 'dictation';

// P221: in-flight model download handles. Settings unmounts on close while the download keeps
// running server-side; the handle lives here so a reopened pane can still cancel.
export const useModelDownloadsStore = defineStore('memoryModelDownloads', () => {
  const controllers: Partial<Record<ModelKind, AbortController>> = {};

  function begin(kind: ModelKind): AbortSignal {
    const controller = new AbortController();
    controllers[kind] = controller;
    return controller.signal;
  }
  function cancel(kind: ModelKind): void {
    controllers[kind]?.abort();
  }
  function end(kind: ModelKind): void {
    delete controllers[kind];
  }
  return { begin, cancel, end };
});
