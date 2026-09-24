<script setup lang="ts">
// G20 D5: shared chrome for a trigger-anchored dropdown — a fresh reimplementation of the old
// hand-rolled `PopoverPanel.vue`'s own shape: a full-viewport,
// `position: fixed`, transparent backdrop (click-outside-closes), an `Escape` handler, and
// positioning via `floatingPosition.ts` against the trigger's own wrapper element (this
// component's own DOM parent) — so no consumer needs to pass an anchor element in explicitly.
// The surface itself is only positioned and sized here (anchor + width); each consumer wraps its
// own list/content in an inner element that owns its own max-height/overflow/flex-direction.
//
// P110 A6: controls.css's `.kui-popover-backdrop`/`.kui-popover` replaced by `kv:` utilities.
// `kv:z-[var(--kui-z-popover,20)]`/`kv:max-h-[var(--kui-float-max-h,none)]`/
// `kv:max-w-[var(--kui-float-max-w,none)]` stay arbitrary values (§1.1 rung 4): each reads a raw
// `--kui-*` custom property with its own fallback, not a value on any Tailwind scale, and none is
// reused by `KuiTooltip`/`KuiContextMenu`/`KuiDialog`'s own distinct classes.
import { onClickOutside } from '@vueuse/core';
import { onMounted, onUnmounted, ref } from 'vue';
import { autoUpdate, computeFloatPosition } from './floatingPosition.ts';

const props = withDefaults(
  defineProps<{
    anchor?: 'left' | 'right';
    width?: number;
    testId?: string;
    backdropTestId?: string;
  }>(),
  { anchor: 'left', width: 240 },
);

const emit = defineEmits<{ close: [] }>();

const backdropEl = ref<HTMLElement | null>(null);
const popoverEl = ref<HTMLElement | null>(null);
const popoverPosition = ref<{ top: string; left: string }>({ top: '0px', left: '0px' });

// Every current consumer renders this component as the sibling of its trigger element, both
// inside one small wrapper div — so this component's own DOM parent (this root element's
// parentElement) *is* that wrapper, and its bounding rect is the trigger's, since the backdrop
// itself is `position: fixed` and so never contributes to the wrapper's own size.
async function reposition(): Promise<void> {
  const anchorEl = backdropEl.value?.parentElement;
  const el = popoverEl.value;
  if (!anchorEl || !el) return;
  const { left, top } = await computeFloatPosition(anchorEl, el, {
    placement: props.anchor === 'right' ? 'bottom-end' : 'bottom-start',
  });
  popoverPosition.value = { top: `${top}px`, left: `${left}px` };
}

// Browsers don't fire blur/focusout when the focused element is simply removed from the DOM —
// focus silently jumps to <body> instead. Moving focus back to the trigger first turns that into
// a real, observable transition.
function restoreFocusToTrigger(): void {
  if (!popoverEl.value?.contains(document.activeElement)) return;
  const anchorEl = backdropEl.value?.parentElement;
  anchorEl?.querySelector<HTMLElement>('button, [tabindex]')?.focus();
}

function close(): void {
  restoreFocusToTrigger();
  emit('close');
}

// P105 §5.2(b): backdrop is a purely visual, full-viewport layer now — click-outside-closes
// moves to VueUse's `onClickOutside` on the popover itself.
//
// F4: P105's own aria-hidden="true" sat on this backdrop div below, an ancestor of the popover
// content, not a sibling -- that hides the whole popover subtree (menus included) from assistive
// tech. Dropped rather than replaced: the backdrop itself renders nothing accessibility-relevant.
onClickOutside(popoverEl, close);

// Capture phase, not bubble: a bubble-phase document listener only runs after the event has
// already bubbled up through every ancestor of wherever focus actually was; capture intercepts
// Escape on the way down, and stopPropagation here keeps it from reaching an ancestor's own
// Escape handler — this popover owns Escape while it's open, full stop.
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation();
    close();
  }
}

let stopAutoUpdate: (() => void) | null = null;

onMounted(() => {
  document.addEventListener('keydown', onKeydown, true);
  const anchorEl = backdropEl.value?.parentElement;
  const el = popoverEl.value;
  if (anchorEl && el) {
    // A first synchronous call so the popover never paints at its (0,0) default even for one
    // frame — autoUpdate's own ResizeObserver setup fires its first callback asynchronously.
    void reposition();
    // autoUpdate, not a bare resize listener — a trigger inside a scrollable tree/list row can
    // move under the popover while it stays open, not just the window resizing.
    stopAutoUpdate = autoUpdate(anchorEl, el, reposition);
  }
});
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown, true);
  stopAutoUpdate?.();
});
</script>

<template>
  <div
    ref="backdropEl"
    class="kv:fixed kv:inset-0 kv:z-[var(--kui-z-popover,20)]"
    :data-testid="backdropTestId"
  >
    <div
      ref="popoverEl"
      class="kv:fixed kv:max-h-[var(--kui-float-max-h,none)] kv:max-w-[var(--kui-float-max-w,none)] kv:overflow-y-auto kv:bg-kui-bg-panel kv:text-kui-fg kv:border kv:border-kui-border-strong kv:rounded-kui-float kv:shadow-kui-float"
      :data-testid="testId"
      :style="{ width: `${props.width}px`, ...popoverPosition }"
    >
      <slot />
    </div>
  </div>
</template>
