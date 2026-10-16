import { ref } from 'vue';
import { errorText } from '../bridge/codedError';

/**
 * One in-flight action: `run` resolves `true` on success, `false` after recording `errorText` in
 * `error`. A bridge write that also patches the query cache uses `useMutation().isPending` instead.
 */
export function useAsyncAction<Args extends unknown[]>(
  action: (...args: Args) => Promise<unknown>,
) {
  const pending = ref(false);
  const error = ref<string | null>(null);
  async function run(...args: Args): Promise<boolean> {
    pending.value = true;
    error.value = null;
    try {
      await action(...args);
      return true;
    } catch (err) {
      error.value = errorText(err);
      return false;
    } finally {
      pending.value = false;
    }
  }
  return { run, pending, error };
}
