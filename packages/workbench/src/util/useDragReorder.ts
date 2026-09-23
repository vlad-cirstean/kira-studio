import { type Ref, ref } from 'vue';

export interface UseDragReorderOptions<T> {
  /** Checked at the top of onDragStart/onDragOver/onDragEnd — a reorder that would otherwise be
   *  ambiguous (e.g. the list is currently filtered, so "index i" doesn't mean the same row on
   *  every render) is refused rather than silently reordering the wrong thing. Defaults to
   *  always-allowed. */
  canReorder?: () => boolean;
  /** Called from onDragEnd, once the drag settles, with the list's own current value — only when
   *  canReorder() still passes at drop time too (a filter toggled mid-drag is still refused).
   *  Omit when a caller persists elsewhere off the same `list` ref (ColumnsMenu.vue's own
   *  onBeforeUnmount). */
  onReorder?: (next: T[]) => void | Promise<void>;
}

/** P107 T2-20: same dragstart/dragover/dragend index bookkeeping and array splice, hand-copied
 *  across EnvironmentsView.vue, VariableSetView.vue and ColumnsMenu.vue. `@vueuse/core` has no
 *  reorder composable; `@vueuse/integrations`' useSortable needs sortablejs (not installed, and
 *  these sites use native drag events over a widget, not a sortable-list library) — hand-written,
 *  once, rather than per call site.
 *
 *  packages/workbench/src/components/TabStrip.vue has the same three-function shape but tracks
 *  the dragged tab by id, not index, and never owns a local array to splice — it mutates the
 *  shared tab list live via `host.tabs.moveTab(from, id)` on every dragover (its own comment: "the
 *  strip itself needs no local copy"). That's a different mechanism, not a duplicate of this one;
 *  not migrated here. */
export function useDragReorder<T>(list: Ref<T[]>, options: UseDragReorderOptions<T> = {}) {
  const dragIndex = ref<number | null>(null);
  const canReorder = options.canReorder ?? (() => true);

  function onDragStart(index: number): void {
    if (!canReorder()) return;
    dragIndex.value = index;
  }

  function onDragOver(index: number): void {
    if (!canReorder()) return;
    const from = dragIndex.value;
    if (from === null || from === index || index >= list.value.length) return;
    const next = [...list.value];
    const [moved] = next.splice(from, 1);
    next.splice(index, 0, moved);
    list.value = next;
    dragIndex.value = index;
  }

  async function onDragEnd(): Promise<void> {
    if (!canReorder()) {
      dragIndex.value = null;
      return;
    }
    dragIndex.value = null;
    await options.onReorder?.(list.value);
  }

  return { dragIndex, onDragStart, onDragOver, onDragEnd };
}
