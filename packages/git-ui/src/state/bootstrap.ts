import type { Ref } from 'vue';

/** Retries a failed bootstrap() — clears the error ref first so a second failure replaces the
 *  first rather than appearing to do nothing (App.vue G10 D19 / ReviewView.vue G12 D6). */
export function retryBootstrap(
  bootError: Ref<string | undefined>,
  bootstrap: () => Promise<void>,
): void {
  bootError.value = undefined;
  void bootstrap().catch((err: unknown) => {
    bootError.value = err instanceof Error ? err.message : String(err);
  });
}
