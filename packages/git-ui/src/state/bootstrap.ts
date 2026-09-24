import type { Ref } from 'vue';

/** Retries a failed bootstrap() — clears the error ref first so a second failure replaces the
 *  first rather than appearing to do nothing (App.vue G10 D19 / ReviewView.vue G12 D6).
 *  `onSuccess`, when given, runs the same success path a first, un-retried bootstrap() would take
 *  (P108 F7: App.vue's cold-bootstrap `pendingUiAction` must fire once, whichever attempt is the
 *  one that actually succeeds). */
export function retryBootstrap(
  bootError: Ref<string | undefined>,
  bootstrap: () => Promise<void>,
  onSuccess?: () => void,
): void {
  bootError.value = undefined;
  void bootstrap()
    .then(() => onSuccess?.())
    .catch((err: unknown) => {
      bootError.value = err instanceof Error ? err.message : String(err);
    });
}
