<script setup lang="ts">
/**
 * P105 §5.2(a): the draggable/keyboard-resizable column separator `CommitGrid.vue` and
 * `StreamView.vue` each hand-rolled with near-identical pointer/keyboard logic — pulled out once
 * here rather than fixed twice. Presentation-free by design (`class`/`style` fall through to the
 * root, so each caller keeps its own positioning CSS) since the two callers style it completely
 * differently (an absolutely-positioned overlay vs. a header-cell-local handle).
 */
const props = withDefaults(
  defineProps<{
    /** Accessible name, e.g. "Resize author column". */
    label: string;
    value: number;
    min: number;
    /** Unset means no upper bound (StreamView's own columns never capped one). */
    max?: number;
    step?: number;
  }>(),
  { max: Number.POSITIVE_INFINITY, step: 8 },
);

const emit = defineEmits<{
  /** Fires continuously while dragging/on each keyboard step — live preview value. */
  (e: 'update:value', next: number): void;
  /** Fires once the drag/keyboard step settles — the value callers should persist. */
  (e: 'change', next: number): void;
  /** P108 Part 11 F10: fires when a drag ends without settling (`pointercancel` — the OS hands the
   *  gesture off elsewhere — or `lostpointercapture` some other way) — never before this fix. A
   *  caller tracking its own live-preview value (StreamView's own `liveResizeWidth`) has no other
   *  signal to reset it on, so it stuck at the aborted drag's last live value, unsaved and
   *  overwritten only by the next drag on some other column. A caller with nothing to reset
   *  (CommitGrid, `update:value` alone drives its own live value) can ignore this event and keep
   *  its existing contract exactly as-is. */
  (e: 'cancel'): void;
}>();

function clamp(next: number): number {
  return Math.min(props.max, Math.max(props.min, Math.round(next)));
}

function onPointerDown(e: PointerEvent): void {
  // P108 Part 11 F10: a right-button (or any non-primary) pointerdown started a drag and captured
  // the pointer too — this handle is a resize affordance, not a context-menu target; the primary
  // button is the only one meant to start a drag (mirrors the button check every other pointer-drag
  // handler in this app already applies before starting one).
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const target = e.currentTarget as HTMLElement;
  const startX = e.clientX;
  const startValue = props.value;
  target.setPointerCapture(e.pointerId);
  const onMove = (moveEvent: PointerEvent): void => {
    emit('update:value', clamp(startValue + (moveEvent.clientX - startX)));
  };
  // F14: without this, an interrupted drag (the OS cancels the pointer -- a touch gesture handed
  // off to scroll/a system gesture, or capture lost some other way) never reached `onUp`, so these
  // window listeners outlived the drag. They leaked (kept `startX`/`startValue` alive per handle
  // instance) and a later, unrelated `pointerup` anywhere in the window would still fire this
  // closure and emit a stale `change` computed from the aborted drag's own start position.
  const cleanup = (): void => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('lostpointercapture', onCancel);
  };
  const onUp = (upEvent: PointerEvent): void => {
    target.releasePointerCapture?.(upEvent.pointerId);
    cleanup();
    emit('change', clamp(startValue + (upEvent.clientX - startX)));
  };
  const onCancel = (): void => {
    cleanup();
    // F10: emitted so a caller tracking its own live-preview value has something to reset it on —
    // see the `cancel` emit's own doc comment above.
    emit('cancel');
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('lostpointercapture', onCancel);
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const next = clamp(props.value + (e.key === 'ArrowRight' ? props.step : -props.step));
  emit('update:value', next);
  emit('change', next);
}
</script>

<template>
  <!-- ARIA separator widget: needs focus, tabindex and aria-valuenow, none of which
       useSemanticElements' preferred native element (<hr>) can carry. -->
  <!-- biome-ignore lint/a11y/useSemanticElements: ARIA separator widget — <hr> can't carry aria-valuenow/tabindex/keydown -->
  <div
    class="kui-column-resize-handle"
    role="separator"
    aria-orientation="vertical"
    :aria-label="label"
    :aria-valuenow="value"
    :aria-valuemin="min"
    :aria-valuemax="max === Number.POSITIVE_INFINITY ? undefined : max"
    :aria-valuetext="`${value} pixels`"
    tabindex="0"
    @pointerdown="onPointerDown"
    @keydown="onKeydown"
  ></div>
</template>
