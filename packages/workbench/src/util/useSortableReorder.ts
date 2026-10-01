import { computed, type Ref, shallowRef, watch } from 'vue';
import { useDraggable } from 'vue-draggable-plus';

/** Moves fromId to toId's pre-splice index — createTabsStore.moveTab's own rule, so a drop onto a
 *  later item lands after it and onto an earlier one lands before it. */
export function moveId(ids: readonly string[], fromId: string, toId: string): string[] {
  const from = ids.indexOf(fromId);
  const to = ids.indexOf(toId);
  if (from < 0 || to < 0 || from === to) return [...ids];
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

interface SortableReorderOptions {
  /** Sortable `draggable` selector for items. */
  draggable: string;
  handle?: string;
  /** Presses here never start a drag; their click still fires. */
  filter?: string;
  direction?: 'horizontal' | 'vertical';
  /** Default true. False keeps the drag clone inside a portalled layer (popover). */
  fallbackOnBody?: boolean;
  disabled?: () => boolean;
}

/** P137's TabStrip pattern, shared: vue-draggable-plus in forceFallback mode bound to an id mirror
 *  (the library reverts its own DOM move only when a list is bound), one onMove per drop. */
export function useSortableReorder(
  container: Ref<HTMLElement | null>,
  ids: () => readonly string[],
  onMove: (fromId: string, toId: string) => void,
  options: SortableReorderOptions,
): { dragging: Readonly<Ref<boolean>> } {
  const rowIds = shallowRef<string[]>([]);
  watch(
    ids,
    (v) => {
      rowIds.value = [...v];
    },
    { immediate: true },
  );
  const dragging = shallowRef(false);

  useDraggable(
    container,
    rowIds,
    computed(() => ({
      draggable: options.draggable,
      handle: options.handle,
      filter: options.filter,
      preventOnFilter: false,
      direction: options.direction,
      disabled: options.disabled?.() ?? false,
      group: { name: 'sortable-reorder', pull: false, put: false },
      forceFallback: true,
      fallbackOnBody: options.fallbackOnBody ?? true,
      fallbackTolerance: 4,
      // Sortable toggles one class name on the ghost, so a single utility.
      ghostClass: 'opacity-50',
      onStart: () => {
        dragging.value = true;
      },
      onEnd: () => {
        dragging.value = false;
      },
      onUpdate: (evt) => {
        const current = ids();
        const from = current[evt.oldDraggableIndex ?? -1];
        const to = current[evt.newDraggableIndex ?? -1];
        if (from && to && from !== to) onMove(from, to);
      },
    })),
  );

  return { dragging };
}
