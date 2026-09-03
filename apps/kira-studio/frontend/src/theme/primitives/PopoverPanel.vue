<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { autoUpdate, computeFloatPosition } from '../floatingPosition';

// Shared chrome for every trigger-anchored popover/menu (ColumnsMenu, FilterHistoryMenu,
// ConsoleSavedMenu, PreviewCommandPanel): a full-viewport transparent backdrop that closes the
// popover on click-outside, plus Escape-to-close. The surface itself is only positioned and
// sized here (anchor + width) — each consumer wraps its own list/content in an inner element
// that owns its own max-height/overflow/flex-direction, since those vary per menu.
//
// Not for workbench/ContextMenu.vue: that menu is anchored to the mouse click point, not to a
// trigger element — a different reference shape (../floatingPosition.ts's own `pointReference`),
// even though P23 moved both onto the same underlying computePosition call.
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
const popoverPosition = ref<{ top: string; left: string }>({ top: '0px', left: '0px' });

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
//
// P23: computePosition reads the floating element's own real getBoundingClientRect, so — unlike
// the old anchoredPosition.ts call this replaced — there is no "guess with offsetHeight, then
// correct after nextTick" two-pass dance: the very first reposition() already sees the popover's
// real, laid-out size.
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
// focus silently jumps to <body> instead. Since this component's content (the calendar day grid,
// a menu item, ...) is v-if'd away on close, closing while something inside it is focused would
// otherwise drop focus to <body> with no bubbling event for a host like CellEditorView's own
// focusout-based staging to observe — permanently losing its "did focus leave the panel" signal
// for the rest of the interaction. Moving focus back to the trigger first turns that into a real,
// observable transition (still inside the host's container, so still correctly stages nothing).
function restoreFocusToTrigger(): void {
  if (!popoverEl.value?.contains(document.activeElement)) return;
  const anchorEl = backdropEl.value?.parentElement;
  anchorEl?.querySelector<HTMLElement>('button, [tabindex]')?.focus();
}

function close(): void {
  restoreFocusToTrigger();
  emit('close');
}

// Capture phase, not bubble: a bubble-phase document listener only runs *after* the event has
// already bubbled up through every ancestor of wherever focus actually was — including a host
// like CellEditorView's own `.editor-body`, whose own Escape handler (revert the whole buffer)
// has no idea this popover exists and would already have run by the time this fires. Capture
// intercepts Escape on the way *down*, before it ever reaches that ancestor, and stopPropagation
// here keeps it from continuing to the target/bubble phases at all — this popover owns Escape
// while it's open, full stop.
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
    // P23: autoUpdate, not a bare resize listener — several consumers (CellEditorView's
    // TimestampPane docked at the window's bottom edge; any menu whose trigger sits in a
    // scrollable tree/list row) can have their trigger move under them while the popover stays
    // open, not just the window resize the old listener covered. autoUpdate also repositions on
    // the popover's own content changing size (a ResizeObserver on the floating element), which
    // is what used to need the manual nextTick(reposition) pass above.
    stopAutoUpdate = autoUpdate(anchorEl, el, reposition);
  }
});
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown, true);
  stopAutoUpdate?.();
});
</script>

<template>
  <div ref="backdropEl" class="menu-backdrop" :data-testid="backdropTestId" @click="close">
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
