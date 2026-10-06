import { useElementByPoint, useMouse, useRafFn } from '@vueuse/core';
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
  // The hit-test loop runs only while a drag does, not for the Plan's whole life.
  const { element, pause, resume } = useElementByPoint({
    x,
    y,
    scheduler: (cb) => useRafFn(cb, { immediate: false }),
  });

  watch(element, (el) => {
    if (draggedId.value) target.value = resolveTarget(el);
  });

  function begin(taskId: string): void {
    draggedId.value = taskId;
    target.value = null;
    resume();
  }

  function end(): void {
    const id = draggedId.value;
    const t = target.value;
    pause();
    draggedId.value = null;
    target.value = null;
    if (id) onDrop(id, t);
  }

  return { draggedId, target, begin, end };
}
