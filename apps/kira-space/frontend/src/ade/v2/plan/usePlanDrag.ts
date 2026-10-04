import { useElementByPoint, useMouse } from '@vueuse/core';
import { ref, watch } from 'vue';
import type { DropTarget } from '../board/dropPlan';

// Shared drag state for the day bands (each band owns a SortableJS list, see AdeDayBand). The
// target is resolved from the pointer while a drag runs; the caller turns the released drag into
// one plan write.
function resolveTarget(el: Element | null): DropTarget | null {
  const card = el?.closest<HTMLElement>('[data-testid="ade-card"]');
  if (card?.dataset.taskId) return { kind: 'card', taskId: card.dataset.taskId };
  const band = el?.closest<HTMLElement>('[data-ade-band]');
  if (band?.dataset.adeDay !== undefined) return { kind: 'band', day: Number(band.dataset.adeDay) };
  return null;
}

export function usePlanDrag(onDrop: (taskId: string, target: DropTarget | null) => void) {
  const draggedId = ref<string | null>(null);
  const target = ref<DropTarget | null>(null);
  const { x, y } = useMouse({ type: 'client' });
  const { element } = useElementByPoint({ x, y });

  watch(element, (el) => {
    if (draggedId.value) target.value = resolveTarget(el);
  });

  function begin(taskId: string): void {
    draggedId.value = taskId;
    target.value = null;
  }

  function end(): void {
    const id = draggedId.value;
    const t = target.value;
    draggedId.value = null;
    target.value = null;
    if (id) onDrop(id, t);
  }

  return { draggedId, target, begin, end };
}
