import { useTimeoutFn } from '@vueuse/core';
import { type Ref, ref } from 'vue';

/** Delay between clearing and re-setting the region. Chromium batches accessibility-tree updates
 *  per frame, so a clear and a set in the same frame net to no change and a repeated identical
 *  message goes unread. */
const REANNOUNCE_DELAY_MS = 100;

/** One polite live region's text. `announce` clears, then sets after a short delay, so a repeated
 *  identical message still produces a DOM change. The pending set is cancelled on scope dispose. */
export function useLiveRegion(): { text: Ref<string>; announce: (message: string) => void } {
  const text = ref('');
  let pending = '';
  const { start } = useTimeoutFn(
    () => {
      text.value = pending;
    },
    REANNOUNCE_DELAY_MS,
    { immediate: false },
  );
  function announce(message: string): void {
    pending = message;
    text.value = '';
    start();
  }
  return { text, announce };
}
