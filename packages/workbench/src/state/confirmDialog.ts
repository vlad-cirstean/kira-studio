import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';

// Replaces window.confirm() for every destructive action in the app. A native confirm panel
// blocks the renderer, steals window focus (closing any open context menu) and is not reliably
// auto-acceptable by Playwright; an ordinary Teleported HTML dialog has none of those problems.
export const useConfirmDialogStore = defineStore('confirmDialog', () => {
  const state = reactive({
    open: false,
    message: '',
    danger: false,
    confirmLabel: '',
    resolve: null as ((value: boolean) => void) | null,
  });

  /** `confirmLabel` defaults to "Delete" when `danger`, else "Continue". */
  function confirmDialog(
    message: string,
    options?: { danger?: boolean; confirmLabel?: string },
  ): Promise<boolean> {
    return new Promise((resolve) => {
      // F9: a second call before the first settles would otherwise overwrite `state.resolve`,
      // leaving the first caller's promise pending forever. Settle it (as a decline) first.
      state.resolve?.(false);
      state.message = message;
      state.danger = options?.danger ?? true;
      state.confirmLabel = options?.confirmLabel ?? '';
      state.resolve = resolve;
      state.open = true;
    });
  }

  function settleConfirmDialog(value: boolean): void {
    state.resolve?.(value);
    state.open = false;
    state.resolve = null;
  }

  return { ...toRefs(state), confirmDialog, settleConfirmDialog };
});
