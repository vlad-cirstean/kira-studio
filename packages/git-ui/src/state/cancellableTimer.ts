import { useDebounceFn } from '@vueuse/core';

export interface CancellableTimer {
  /** Arms the timer; a call within the delay replaces the pending one. */
  start(delay?: number): void;
  /** Drops the pending run, if any. */
  stop(): void;
  readonly pending: boolean;
}

/** One-shot timer on VueUse `useDebounceFn`: its `useTimeoutFn` never starts without `window`
 *  (bun unit tests), and this VueUse version has no debounce cancel, so a generation guard drops
 *  stopped runs. */
export function createCancellableTimer(run: () => void, defaultDelay: number): CancellableTimer {
  let generation = 0;
  let pending = false;
  let delay = defaultDelay;
  const fire = useDebounceFn(
    (armedAt: number) => {
      if (armedAt !== generation) return;
      pending = false;
      run();
    },
    () => delay,
  );
  return {
    start(next = defaultDelay) {
      delay = next;
      pending = true;
      void fire(++generation);
    },
    stop() {
      generation++;
      pending = false;
    },
    get pending() {
      return pending;
    },
  };
}
