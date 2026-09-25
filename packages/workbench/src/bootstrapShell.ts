import { createApp } from 'vue';
import BootFailure from './components/BootFailure.vue';

// P113 F6: kira-space's and kira-studio's own main.ts each wrote this identical catch-and-retry
// wrapper around their own app-specific mountShell() (P100 Part 2 F2 / P108 Part 12 F13) —
// mountShell's own hydrates can reject (a DB error, or a busy DB past its lock timeout). Left
// uncaught, that rejection skips app.mount entirely: a permanently blank window, logged only as an
// unhandled rejection in the webview console. This mounts BootFailure instead, with a Retry that
// re-runs the whole sequence.
export async function bootstrapShell(
  mountShell: () => Promise<void>,
  appName: string,
): Promise<void> {
  try {
    await mountShell();
  } catch (err) {
    console.error('bootstrap: failed to hydrate/mount the shell', err);
    const failureApp = createApp(BootFailure, {
      appName,
      message: err instanceof Error ? err.message : String(err),
      onRetry: () => {
        failureApp.unmount();
        void bootstrapShell(mountShell, appName);
      },
    });
    failureApp.mount('#app');
  }
}
