import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';

// Replaces window.confirm() for every destructive action in the app. Electron renders
// window.confirm as a real native OS panel rather than an in-page dialog — it blocks the
// renderer's main thread until a human dismisses it, steals window focus (closing any open
// context menu via its 'blur' listener), and isn't reliably auto-acceptable by Playwright's
// page.on('dialog') under Electron, which made UI tests hang on a genuinely stuck system panel.
// An ordinary Teleported HTML dialog has none of those problems and looks the same either way.
export const useConfirmDialogStore = defineStore('confirmDialog', () => {
  const state = reactive({
    open: false,
    message: '',
    danger: false,
    resolve: null as ((value: boolean) => void) | null,
  });

  function confirmDialog(message: string, options?: { danger?: boolean }): Promise<boolean> {
    return new Promise((resolve) => {
      state.message = message;
      state.danger = options?.danger ?? true;
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
