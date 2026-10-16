import { SPINNER_DELAY } from '@theme/timing';
import { useTimeoutFn } from '@vueuse/core';
import { type MaybeRefOrGetter, readonly, ref, toValue, watch } from 'vue';

/** True once `active` has held for `SPINNER_DELAY` ms, so a fast load never flashes a placeholder. */
export function useSpinnerDelay(active: MaybeRefOrGetter<boolean>) {
  const ready = ref(false);
  const { start, stop } = useTimeoutFn(() => (ready.value = true), SPINNER_DELAY, {
    immediate: false,
  });
  watch(
    () => toValue(active),
    (on) => {
      stop();
      ready.value = false;
      if (on) start();
    },
    { immediate: true },
  );
  return readonly(ready);
}
