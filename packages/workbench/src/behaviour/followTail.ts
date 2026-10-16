import { useScroll } from '@vueuse/core';
import { nextTick, type Ref, type WatchSource, watch } from 'vue';

/** Pixels from the bottom that still count as "at the bottom". */
const TAIL_TOLERANCE = 8;

/**
 * Keep a scroller pinned to its bottom while the reader is at the bottom. `trigger` changes when
 * content is appended. Without `follow` (or while it is `undefined`), the reader scrolling up stops
 * the follow and scrolling back down resumes it. With a boolean `follow` (an explicit toggle),
 * `follow` decides, and scrolling up turns it off.
 */
export function useFollowTail(
  el: Ref<HTMLElement | null>,
  trigger: WatchSource,
  opts: { follow?: Ref<boolean | undefined> } = {},
) {
  const { arrivedState } = useScroll(el, {
    offset: { bottom: TAIL_TOLERANCE },
    onScroll: () => {
      if (opts.follow?.value && !arrivedState.bottom) opts.follow.value = false;
    },
  });

  function stick(): void {
    if (el.value) el.value.scrollTop = el.value.scrollHeight;
  }

  // Read before the DOM grows: after the append the reader no longer looks "at the bottom".
  watch(trigger, async () => {
    const follow = opts.follow?.value ?? arrivedState.bottom;
    await nextTick();
    if (follow) stick();
  });

  /** Resume following and jump to the newest line. */
  function jumpToLatest(): void {
    if (opts.follow && opts.follow.value !== undefined) opts.follow.value = true;
    void nextTick(stick);
  }

  return { atBottom: () => arrivedState.bottom, jumpToLatest, stick };
}
