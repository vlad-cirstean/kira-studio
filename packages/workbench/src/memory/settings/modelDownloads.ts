import { defineStore } from 'pinia';

// P221: in-flight semantic model download handle. Settings unmounts on close while the download
// keeps running server-side; the handle lives here so a reopened pane can still cancel.
export const useModelDownloadsStore = defineStore('memoryModelDownloads', () => {
  let controller: AbortController | undefined;

  function begin(): AbortSignal {
    controller = new AbortController();
    return controller.signal;
  }
  function cancel(): void {
    controller?.abort();
  }
  function end(): void {
    controller = undefined;
  }
  return { begin, cancel, end };
});
