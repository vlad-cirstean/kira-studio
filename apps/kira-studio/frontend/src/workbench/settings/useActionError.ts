import { ref } from 'vue';

/** Instant-action settings (bypassing draft/Save) report a rejected call here, so the checkbox
 *  that snaps back is not the only trace of the failure. */
export function useActionError() {
  const error = ref<string | null>(null);
  function guard<Args extends unknown[]>(action: (...args: Args) => Promise<void>) {
    return async (...args: Args): Promise<void> => {
      error.value = null;
      try {
        await action(...args);
      } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
      }
    };
  }
  return { error, guard };
}
