import { useIntervalFn } from '@vueuse/core';
import { ref } from 'vue';

/** The bridge refuses a launch with this code while the branch's prepare script still runs. */
export const isPreparing = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'E_PREPARING';

/**
 * Holds a launch back until its worktree is prepared: `start()` repeats `retry` every few seconds.
 * The retry ends the wait itself (`stop()`) once it succeeds or fails for another reason; it stays
 * armed while the bridge still answers E_PREPARING, which has no side effect.
 */
export function useSetupWait(retry: () => Promise<void>, intervalMs = 2000) {
  const waiting = ref(false);
  let busy = false;
  const timer = useIntervalFn(
    async () => {
      if (busy || !waiting.value) return;
      busy = true;
      try {
        await retry();
      } finally {
        busy = false;
      }
    },
    intervalMs,
    { immediate: false },
  );
  function start(): void {
    waiting.value = true;
    timer.resume();
  }
  function stop(): void {
    waiting.value = false;
    timer.pause();
  }
  return { waiting, start, stop };
}
