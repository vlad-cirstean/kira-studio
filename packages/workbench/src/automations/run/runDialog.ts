import { defineStore } from 'pinia';
import { ref } from 'vue';

/** What the run dialog opens for: a script, and values to start from (Run again). */
export interface RunDialogRequest {
  scriptId: string;
  prefill?: Record<string, string[]>;
}

// One concern: the single open run-dialog request. Any module opens it; the host in each app's
// WorkbenchShell renders it.
export const useScriptRunDialogStore = defineStore('scriptRunDialog', () => {
  const request = ref<RunDialogRequest | null>(null);

  function open(req: RunDialogRequest): void {
    request.value = req;
  }

  function close(): void {
    request.value = null;
  }

  return { request, open, close };
});
