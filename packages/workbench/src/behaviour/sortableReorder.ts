import { useEventListener } from '@vueuse/core';
import { computed, nextTick, type Ref, shallowRef, watch } from 'vue';
import { useDraggable } from 'vue-draggable-plus';
import { shortcutFor } from '../shortcuts/keys';

/** The one drag-ghost class; Sortable toggles a single class name. */
export const SORTABLE_GHOST_CLASS = 'opacity-50';
/** The one class on the item being dragged, for a drag that needs more than the ghost. */
export const SORTABLE_CHOSEN_CLASS = 'ring-2';

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

const VERTICAL_IDS = ['list.moveUp', 'list.moveDown'] as const;
const HORIZONTAL_IDS = ['list.moveLeft', 'list.moveRight'] as const;

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
  /** Alt+arrow moves the focused item one place (`list.move*`); items must be focusable. */
  keyboard?: boolean;
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
  let cancelled = false;

  const sortable = useDraggable(
    container,
    rowIds,
    computed(() => ({
      // Bound below once the element exists: a portalled container is absent at mount.
      immediate: false,
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
      ghostClass: SORTABLE_GHOST_CLASS,
      onStart: () => {
        dragging.value = true;
        cancelled = false;
      },
      onEnd: () => {
        dragging.value = false;
      },
      onUpdate: (evt) => {
        const current = ids();
        if (cancelled) {
          rowIds.value = [...current];
          return;
        }
        const from = current[evt.oldDraggableIndex ?? -1];
        const to = current[evt.newDraggableIndex ?? -1];
        if (from && to && from !== to) onMove(from, to);
      },
    })),
  );

  // Esc during a drag drops the item back where it started.
  useEventListener(document, 'keydown', (e: KeyboardEvent) => {
    if (dragging.value && e.key === 'Escape') cancelled = true;
  });

  if (options.keyboard) {
    const axisIds = options.direction === 'horizontal' ? HORIZONTAL_IDS : VERTICAL_IDS;
    useEventListener(container, 'keydown', (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented || options.disabled?.()) return;
      const id = shortcutFor(e, axisIds);
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(options.draggable);
      if (id === null || !el || !container.value?.contains(el)) return;
      const items = [...container.value.querySelectorAll<HTMLElement>(options.draggable)];
      const current = ids();
      const from = current[items.indexOf(el)];
      const step = id === 'list.moveUp' || id === 'list.moveLeft' ? -1 : 1;
      const to = current[items.indexOf(el) + step];
      if (!from || !to) return;
      e.preventDefault();
      onMove(from, to);
      // A keyed row keeps its element across the reorder; the move can drop its focus.
      void nextTick(() => {
        if (el.isConnected) el.focus();
      });
    });
  }

  watch(
    container,
    (el) => {
      if (el) sortable.start(el);
    },
    { immediate: true, flush: 'post' },
  );

  return { dragging };
}
