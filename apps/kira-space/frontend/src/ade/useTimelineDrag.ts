import type { Ref } from 'vue';
import { useDraggable } from 'vue-draggable-plus';
import { useAdeDragStore } from './state/adeDrag';

// P129 Part 5 §0.12: one `useDraggable` per band's own box list (`level: 'block'`, items
// `[data-ade-block]`, handle `[data-ade-box]` — a drag started on a review row or the box edge
// matches nothing in the box's own row list, so it bubbles here and drags the whole box) or per
// box's own row list (`level: 'row'`, items `[data-ade-row-movable]`). `sort: false` and
// `group: {pull: false, put: false}` with no bound list (measured in the library's own source, §0.12)
// mean SortableJS never actually moves Vue-managed DOM — `adeDrag` supplies the ids and drop target
// instead, and `AdeTimeline`'s own pointer tracking (`useMouse`/`useElementByPoint`) is what decides
// the target while a drag is active.
export type TimelineDragLevel = 'block' | 'row';

const DRAGGABLE_SELECTOR: Record<TimelineDragLevel, string> = {
  block: '[data-ade-block]',
  row: '[data-ade-row-movable]',
};

export type DropResult = ReturnType<ReturnType<typeof useAdeDragStore>['finish']>;

/** Row drag ids are the one row's own id (`data-ade-id`, mockup's own `[id]`); box drag ids are the
 *  segment's own `dragIds` (`data-ade-drag-ids`, comma-joined — every id here is already a plain
 *  branch/new-work id, never containing a comma). */
function dragIdsFor(level: TimelineDragLevel, item: HTMLElement): string[] {
  if (level === 'row') {
    const id = item.dataset.adeId;
    return id ? [id] : [];
  }
  const raw = item.dataset.adeDragIds ?? '';
  return raw ? raw.split(',') : [];
}

export function useTimelineDrag(
  el: Ref<HTMLElement | null | undefined>,
  level: TimelineDragLevel,
  onDrop: (result: NonNullable<DropResult>) => void,
): void {
  const adeDrag = useAdeDragStore();

  useDraggable(el, {
    draggable: DRAGGABLE_SELECTOR[level],
    handle: level === 'block' ? '[data-ade-box]' : undefined,
    sort: false,
    group: { name: 'ade-plan', pull: false, put: false },
    forceFallback: true,
    fallbackOnBody: true,
    fallbackTolerance: 4,
    // §0.12: single Tailwind utilities — Sortable toggles one class name on the dragged/ghost
    // element, so a multi-class combo would only ever apply its first class.
    ghostClass: 'opacity-40',
    chosenClass: 'ring-2',
    onStart: (evt) => adeDrag.begin(dragIdsFor(level, evt.item)),
    onEnd: () => {
      const result = adeDrag.finish();
      if (result) onDrop(result);
    },
  });
}
