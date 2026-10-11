import { unrefElement, useEventListener, watchDebounced } from '@vueuse/core';
import { computed, type Ref } from 'vue';
import { TIMING } from './timing';

/** The find bar's keys and query debounce: Enter next, Shift+Enter previous, Escape close (all
 *  IME-safe), `onQuery` called once typing pauses for `TIMING.search`. `root` is the bar's element
 *  or component, where the key events are caught. */
export function useFindBar(opts: {
  root: Ref<unknown>;
  query: Ref<string>;
  onQuery: (query: string) => void;
  next: () => void;
  prev: () => void;
  close: () => void;
}): void {
  watchDebounced(opts.query, (query) => opts.onQuery(query), { debounce: TIMING.search });
  useEventListener(
    computed(() => unrefElement(opts.root as never)),
    'keydown',
    (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        opts.close();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) opts.prev();
        else opts.next();
      }
    },
  );
}
