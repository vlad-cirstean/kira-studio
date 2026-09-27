import { useEventListener, useTimeoutFn } from '@vueuse/core';
import { computed, type Ref, ref, watch } from 'vue';

// P129 Part 5 §0.7: the closed timeline's own scroll-pull-to-open gesture (mockup 1788-1797,
// `pull`/`over`/`revealHistory`) — VueUse `useEventListener` plus `useTimeoutFn` for the ~0.7s
// reset, no bespoke wheel/timer plumbing. `open()` fires once at the 400 threshold; the caller
// flips `isOpen`, which this composable also watches to reset its own pull on any external close
// (Hide history) so a later re-open starts from zero, not a stale in-flight pull.
export function useHistoryPull(
  scrollEl: Ref<HTMLElement | null | undefined>,
  isOpen: Ref<boolean>,
  open: () => void,
): { pull: Ref<number>; pct: Readonly<Ref<number>> } {
  const pull = ref(0);
  const pct = computed(() => Math.min(100, Math.round(pull.value / 4)));

  const { start: restartReset } = useTimeoutFn(
    () => {
      pull.value = 0;
    },
    700,
    { immediate: false },
  );

  watch(isOpen, (open_) => {
    if (!open_) pull.value = 0;
  });

  useEventListener(
    scrollEl,
    'wheel',
    (e: WheelEvent) => {
      if (isOpen.value) return;
      const el = scrollEl.value;
      if (el && el.scrollTop === 0 && e.deltaY < 0) {
        pull.value += Math.min(120, -e.deltaY);
        restartReset();
        if (pull.value >= 400) open();
      } else {
        pull.value = 0;
      }
    },
    { passive: true },
  );

  return { pull, pct };
}
