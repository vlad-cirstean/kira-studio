import { reactive } from 'vue';

// Transient status-bar messages (e.g. "Count rows" results from the tree context menu). Auto-clear
// after a few seconds; the status bar renders the latest one.

export const statusState = reactive({
  message: null as string | null,
});

let timer: ReturnType<typeof setTimeout> | null = null;

export function showStatusMessage(message: string): void {
  statusState.message = message;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    statusState.message = null;
  }, 5000);
}
