import { useTimeoutFn } from '@vueuse/core';
import { type Ref, ref } from 'vue';
import { TIMING } from './timing';

/** One polite live region's text. `announce` clears, then sets after `TIMING.reannounce`, so a
 *  repeated identical message still produces a DOM change (Chromium batches accessibility-tree
 *  updates per frame, so a clear and a set in the same frame net to no change). The pending set is
 *  cancelled on scope dispose. */
function createRegion(): { text: Ref<string>; announce: (message: string) => void } {
  const text = ref('');
  let pending = '';
  const { start } = useTimeoutFn(
    () => {
      text.value = pending;
    },
    TIMING.reannounce,
    { immediate: false },
  );
  function announce(message: string): void {
    pending = message;
    text.value = '';
    start();
  }
  return { text, announce };
}

export function useLiveRegion(): { text: Ref<string>; announce: (message: string) => void } {
  return createRegion();
}

// The app-level polite region, one per shell (`AppLiveRegion.vue`): async outcomes with no visible
// home of their own (a copy from a menu, a failed load) are still announced.
const appRegion = createRegion();

export function announceApp(message: string): void {
  appRegion.announce(message);
}

export const appAnnouncement: Ref<string> = appRegion.text;
