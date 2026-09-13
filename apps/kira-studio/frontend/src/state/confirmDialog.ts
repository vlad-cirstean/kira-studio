import { reactive } from 'vue';

// Replaces window.confirm() for every destructive action in the app. Electron renders
// window.confirm as a real native OS panel rather than an in-page dialog — it blocks the
// renderer's main thread until a human dismisses it, steals window focus (closing any open
// context menu via its 'blur' listener), and isn't reliably auto-acceptable by Playwright's
// page.on('dialog') under Electron, which made UI tests hang on a genuinely stuck system panel.
// An ordinary Teleported HTML dialog has none of those problems and looks the same either way.
interface ConfirmDialogState {
  open: boolean;
  message: string;
  danger: boolean;
  resolve: ((value: boolean) => void) | null;
}

export const confirmDialogState: ConfirmDialogState = reactive({
  open: false,
  message: '',
  danger: false,
  resolve: null,
});

export function confirmDialog(message: string, options?: { danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    confirmDialogState.message = message;
    confirmDialogState.danger = options?.danger ?? true;
    confirmDialogState.resolve = resolve;
    confirmDialogState.open = true;
  });
}

export function settleConfirmDialog(value: boolean): void {
  confirmDialogState.resolve?.(value);
  confirmDialogState.open = false;
  confirmDialogState.resolve = null;
}
