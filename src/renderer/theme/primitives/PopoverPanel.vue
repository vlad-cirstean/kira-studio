<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';

// Shared chrome for every trigger-anchored popover/menu (ColumnsMenu, FilterHistoryMenu,
// ConsoleSavedMenu, PreviewCommandPanel): a full-viewport transparent backdrop that closes the
// popover on click-outside, plus Escape-to-close. The surface itself is only positioned and
// sized here (anchor + width) — each consumer wraps its own list/content in an inner element
// that owns its own max-height/overflow/flex-direction, since those vary per menu.
//
// Not for workbench/ContextMenu.vue: that menu is anchored to the mouse click point with its
// own positioning math, not to a trigger element — a different model, left untouched.
const props = withDefaults(
  defineProps<{
    anchor?: 'left' | 'right';
    width?: number;
    testId?: string;
    backdropTestId?: string;
  }>(),
  { anchor: 'right', width: 240 },
);

const emit = defineEmits<{ close: [] }>();

const backdropEl = ref<HTMLElement | null>(null);
const popoverEl = ref<HTMLElement | null>(null);
const popoverPosition = ref<{ top?: string; bottom?: string; left?: string; right?: string }>({
  top: '0px',
});

// Task #58: this used to be `position: absolute; top: 32px; left/right: 8px`, which positions
// against the nearest *positioned* ancestor — not necessarily (and in practice, rarely) the
// button that opened the menu, since `.menu-backdrop` below is itself `position: fixed`, and a
// fixed element always establishes its own containing block. So every menu's "anchor" resolved to
// that full-viewport backdrop, i.e. a corner of the window, regardless of which toolbar button was
// clicked. Fixed here by measuring the real trigger and positioning against the viewport (fixed,
// matching the backdrop's own coordinate space) instead of guessing an ancestor will cooperate.
//
// Every current consumer renders this component as the sibling of its trigger `<IconButton>`,
// both inside one small wrapper div (`<div class="columns-anchor"><IconButton /><ColumnsMenu />
// </div>`, and the same shape for every other menu) — so this component's own DOM parent (this
// root element's parentElement) *is* that wrapper, and its bounding rect is the trigger's, since
// the backdrop itself is `position: fixed` and so never contributes to the wrapper's own size.
// That means no consumer needs to pass an anchor element in explicitly, and none needs to
// remember `position: relative` on its wrapper for this to resolve correctly either.
// Task: the cell editor panel is docked at the bottom of the window, so a popover anchored
// below its trigger (the timestamp calendar button, in particular) routinely has nowhere to
// grow into and rendered off the bottom of the viewport. Opening upward instead when there
// isn't room below fixes that generically for every PopoverPanel consumer, not just that one.
function reposition(): void {
  const anchorEl = backdropEl.value?.parentElement;
  if (!anchorEl) return;
  const rect = anchorEl.getBoundingClientRect();
  const gap = 4;
  const horiz =
    props.anchor === 'left'
      ? { left: `${rect.left}px` }
      : { right: `${Math.max(0, window.innerWidth - rect.right)}px` };

  // Before the popover has ever rendered, popoverEl has no height to measure yet — reposition()
  // runs again once it does (see the nextTick call in onMounted below), so the first paint's
  // guess is corrected before the user can see it.
  const popoverHeight = popoverEl.value?.offsetHeight ?? 0;
  const spaceBelow = window.innerHeight - rect.bottom - gap;
  const spaceAbove = rect.top - gap;
  const opensUpward = popoverHeight > spaceBelow && spaceAbove > spaceBelow;

  popoverPosition.value = opensUpward
    ? { bottom: `${window.innerHeight - rect.top + gap}px`, ...horiz }
    : { top: `${rect.bottom + gap}px`, ...horiz };
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close');
}

onMounted(() => {
  reposition();
  // The first reposition() runs before popoverEl has ever painted, so its offsetHeight read
  // above is 0 and the upward-flip decision cannot yet be made — this second pass, after the
  // real content has laid out, corrects it before the user can see the wrong placement.
  void nextTick(reposition);
  document.addEventListener('keydown', onKeydown);
  // The window is resizable and this menu can stay open across a resize — recomputing keeps it
  // pinned to its trigger instead of drifting toward whichever corner it started near.
  window.addEventListener('resize', reposition);
});
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
  window.removeEventListener('resize', reposition);
});
</script>

<template>
  <div ref="backdropEl" class="menu-backdrop" :data-testid="backdropTestId" @click="emit('close')">
    <div
      ref="popoverEl"
      class="popover p-float"
      :data-testid="testId"
      :style="{ width: `${props.width}px`, ...popoverPosition }"
      @click.stop
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
}

/* top/left/right are set inline above, computed from the trigger's own bounding rect — see
   reposition(). Fixed (not absolute) so those viewport-relative coordinates need no cooperating
   positioned ancestor at all. */
.popover {
  position: fixed;
}
</style>
