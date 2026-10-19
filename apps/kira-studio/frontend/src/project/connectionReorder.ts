import { useElementByPoint, useEventListener, useMouse, useRafFn } from '@vueuse/core';
import { DRAG_TOLERANCE_PX } from '@workbench/behaviour/sortableReorder';
import { type Ref, shallowRef, watch } from 'vue';

const CONNECTION_ROW = '[role="treeitem"][data-kind="connection"]';

export interface ConnectionDrop {
  id: string;
  edge: 'top' | 'bottom';
}

/** Order after dropping `dragged` on `target`'s top or bottom edge; the input when nothing moves. */
function orderAfterDrop(ids: readonly string[], dragged: string, drop: ConnectionDrop): string[] {
  const rest = ids.filter((id) => id !== dragged);
  const at = rest.indexOf(drop.id);
  if (at < 0 || !ids.includes(dragged)) return [...ids];
  rest.splice(drop.edge === 'top' ? at : at + 1, 0, dragged);
  return rest;
}

/**
 * Pointer drag reorder for the virtualized project tree. Sortable cannot serve it: only the visible
 * window is mounted, rows are absolutely positioned, and child rows interleave the connection
 * rows. A drop lands before or after the connection row under the pointer.
 */
export function useConnectionReorder(opts: {
  container: Ref<HTMLElement | null>;
  ids: () => readonly string[];
  disabled: () => boolean;
  rowHeight: () => number;
  onReorder: (ids: string[]) => void;
}): {
  draggingId: Readonly<Ref<string | null>>;
  drop: Readonly<Ref<ConnectionDrop | null>>;
} {
  const draggingId = shallowRef<string | null>(null);
  const drop = shallowRef<ConnectionDrop | null>(null);
  let pressId: string | null = null;
  let pressAt = { x: 0, y: 0 };
  let swallowClick = false;

  const { x, y } = useMouse({ type: 'client' });
  const hit = useElementByPoint({
    x,
    y,
    scheduler: (cb) => useRafFn(cb, { immediate: false }),
  });
  const scroller = useRafFn(
    () => {
      const el = opts.container.value;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const zone = opts.rowHeight();
      const step = zone / 4;
      if (y.value < rect.top + zone) el.scrollTop -= step;
      else if (y.value > rect.bottom - zone) el.scrollTop += step;
    },
    { immediate: false },
  );

  watch([hit.element, y], ([el]) => {
    if (!draggingId.value) return;
    const row = el?.closest<HTMLElement>(CONNECTION_ROW);
    const id = row?.dataset.connectionId;
    if (!row || !id || id === draggingId.value) {
      drop.value = null;
      return;
    }
    const rect = row.getBoundingClientRect();
    drop.value = { id, edge: y.value < rect.top + rect.height / 2 ? 'top' : 'bottom' };
  });

  function reset(): void {
    pressId = null;
    draggingId.value = null;
    drop.value = null;
    hit.pause();
    scroller.pause();
  }

  function finish(commit: boolean): void {
    const dragged = draggingId.value;
    const target = drop.value;
    reset();
    if (!commit || !dragged || !target) return;
    const current = opts.ids();
    const next = orderAfterDrop(current, dragged, target);
    if (next.some((id, i) => id !== current[i])) opts.onReorder(next);
  }

  useEventListener(opts.container, 'pointerdown', (e: PointerEvent) => {
    swallowClick = false;
    if (e.button !== 0 || !e.isPrimary || opts.disabled()) return;
    const id = (e.target as HTMLElement | null)?.closest<HTMLElement>(CONNECTION_ROW)?.dataset
      .connectionId;
    if (!id) return;
    pressId = id;
    pressAt = { x: e.clientX, y: e.clientY };
  });

  useEventListener(document, 'pointermove', (e: PointerEvent) => {
    if (pressId === null || draggingId.value !== null) return;
    if (Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) < DRAG_TOLERANCE_PX) return;
    draggingId.value = pressId;
    swallowClick = true;
    hit.resume();
    scroller.resume();
  });
  useEventListener(document, 'pointerup', () => {
    if (draggingId.value) finish(true);
    else pressId = null;
  });
  useEventListener(document, 'pointercancel', () => finish(false));
  useEventListener(document, 'keydown', (e: KeyboardEvent) => {
    if (draggingId.value && e.key === 'Escape') finish(false);
  });
  // A finished drag must not also select or open the row the pointer came up on.
  useEventListener(
    opts.container,
    'click',
    (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
    },
    { capture: true },
  );

  return { draggingId, drop };
}
