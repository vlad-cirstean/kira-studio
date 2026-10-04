import { useElementByPoint, useMouse } from '@vueuse/core';
import { type Ref, ref, watch } from 'vue';
import { useDraggable } from 'vue-draggable-plus';
import type { DropTarget } from '../board/dropPlan';

// One `useDraggable` on the whole timeline (items: task cards). `sort: false` and no group
// pull/put mean SortableJS never moves Vue-managed DOM; the drop target is resolved from the
// pointer instead, and the caller turns the released drag into one plan write.
function resolveTarget(el: Element | null): DropTarget | null {
  const card = el?.closest<HTMLElement>('[data-testid="ade-card"]');
  if (card?.dataset.taskId) return { kind: 'card', taskId: card.dataset.taskId };
  const band = el?.closest<HTMLElement>('[data-ade-band]');
  if (band?.dataset.adeDay !== undefined) return { kind: 'band', day: Number(band.dataset.adeDay) };
  return null;
}

export function usePlanDrag(
  root: Ref<HTMLElement | null | undefined>,
  onDrop: (taskId: string, target: DropTarget | null) => void,
) {
  const draggedId = ref<string | null>(null);
  const target = ref<DropTarget | null>(null);
  const { x, y } = useMouse({ type: 'client' });
  const { element } = useElementByPoint({ x, y });

  watch(element, (el) => {
    if (draggedId.value) target.value = resolveTarget(el);
  });

  useDraggable(root, {
    draggable: '[data-ade-card]',
    sort: false,
    group: { name: 'ade-plan', pull: false, put: false },
    forceFallback: true,
    fallbackOnBody: true,
    fallbackTolerance: 4,
    ghostClass: 'opacity-40',
    chosenClass: 'ring-2',
    onStart: (evt) => {
      draggedId.value = evt.item.dataset.taskId ?? null;
      target.value = null;
    },
    onEnd: () => {
      const id = draggedId.value;
      const t = target.value;
      draggedId.value = null;
      target.value = null;
      if (id) onDrop(id, t);
    },
  });

  return { draggedId, target };
}
