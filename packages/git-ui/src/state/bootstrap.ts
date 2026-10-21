import { errorText } from '@workbench/bridge/codedError';
import type { Ref } from 'vue';

/** Retries a failed bootstrap() — clears the error ref first so a second failure replaces the
 *  first rather than appearing to do nothing (App.vue / ReviewView.vue).
 *  `onSuccess`, when given, runs the same success path a first, un-retried bootstrap() would take
 *  (App.vue's cold-bootstrap `pendingUiAction` must fire once, whichever attempt is the
 *  one that succeeds). */
export function retryBootstrap(
  bootError: Ref<string | undefined>,
  bootstrap: () => Promise<void>,
  onSuccess?: () => void,
): void {
  bootError.value = undefined;
  void bootstrap()
    .then(() => onSuccess?.())
    .catch((err: unknown) => {
      bootError.value = errorText(err);
    });
}
