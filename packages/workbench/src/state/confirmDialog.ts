import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import { errorText } from '../bridge/codedError';

export interface ConfirmOptions {
  message: string;
  /** Dialog title. Default "Confirm". */
  title?: string;
  confirmLabel: string;
  /** `danger` discards or deletes (confirm button red, focus starts on Cancel). Always stated. */
  tone: 'danger' | 'primary';
  /** Work to do on confirm. The dialog stays open with a busy button and shows a rejection inline;
   *  it closes when `run` resolves. */
  run?: () => Promise<unknown>;
}

// Replaces window.confirm() for every destructive action in the app. A native confirm panel
// blocks the renderer, steals window focus (closing any open context menu) and is not reliably
// auto-acceptable by Playwright; an ordinary Teleported HTML dialog has none of those problems.
export const useConfirmDialogStore = defineStore('confirmDialog', () => {
  const state = reactive({
    open: false,
    title: 'Confirm',
    message: '',
    tone: 'danger' as 'danger' | 'primary',
    confirmLabel: '',
    busy: false,
    error: '',
    run: null as (() => Promise<unknown>) | null,
    resolve: null as ((value: boolean) => void) | null,
  });

  function confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      // F9: a second call before the first settles would otherwise overwrite `state.resolve`,
      // leaving the first caller's promise pending forever. Settle it (as a decline) first.
      state.resolve?.(false);
      state.title = options.title ?? 'Confirm';
      state.message = options.message;
      state.tone = options.tone;
      state.confirmLabel = options.confirmLabel;
      state.run = options.run ?? null;
      state.busy = false;
      state.error = '';
      state.resolve = resolve;
      state.open = true;
    });
  }

  function finish(value: boolean): void {
    state.resolve?.(value);
    state.open = false;
    state.resolve = null;
    state.run = null;
  }

  async function acceptConfirm(): Promise<void> {
    if (state.busy) return;
    if (!state.run) {
      finish(true);
      return;
    }
    state.busy = true;
    state.error = '';
    try {
      await state.run();
      finish(true);
    } catch (err) {
      state.error = errorText(err);
    } finally {
      state.busy = false;
    }
  }

  function cancelConfirm(): void {
    if (state.busy) return;
    finish(false);
  }

  return { ...toRefs(state), confirm, acceptConfirm, cancelConfirm };
});
