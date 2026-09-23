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
}>();

function clamp(next: number): number {
  return Math.min(props.max, Math.max(props.min, Math.round(next)));
}

function onPointerDown(e: PointerEvent): void {
  e.preventDefault();
  e.stopPropagation();
  const target = e.currentTarget as HTMLElement;
  const startX = e.clientX;
  const startValue = props.value;
  target.setPointerCapture(e.pointerId);
  const onMove = (moveEvent: PointerEvent): void => {
    emit('update:value', clamp(startValue + (moveEvent.clientX - startX)));
  };
  const onUp = (upEvent: PointerEvent): void => {
    target.releasePointerCapture?.(upEvent.pointerId);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    emit('change', clamp(startValue + (upEvent.clientX - startX)));
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
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
