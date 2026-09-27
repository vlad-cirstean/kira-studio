import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { DropTarget } from '../timelineOps';

// P129 Part 5 §0.12/§2.5: drag ids and the current drop target — SortableJS (via `useTimelineDrag`)
// never moves Vue-managed DOM of its own (`sort: false`, no bound list), so the actual "what's being
// dragged, what's under the pointer" state lives here instead. `AdeTimeline`'s own pointer tracking
// (`useMouse`/`useElementByPoint`) writes `target` while `ids` is non-null; `finish()` is every
// `useTimelineDrag` instance's own `onEnd`, returning the pair once for that drag's own dispatch.
export const useAdeDragStore = defineStore('adeDrag', () => {
  const ids = ref<string[] | null>(null);
  const target = ref<DropTarget | null>(null);

  function begin(dragIds: readonly string[]): void {
    ids.value = [...dragIds];
    target.value = null;
  }

  function setTarget(t: DropTarget | null): void {
    target.value = t;
  }

  function finish(): { ids: string[]; target: DropTarget | null } | null {
    const result = ids.value ? { ids: ids.value, target: target.value } : null;
    ids.value = null;
    target.value = null;
    return result;
  }

  return { ids, target, begin, setTarget, finish };
});
