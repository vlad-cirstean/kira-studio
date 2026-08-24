<script setup lang="ts">
// P22 D4/D5: the app-owned tooltip singleton, mounted once beside <ContextMenu /> in App.vue.
// Placement mirrors ErrorPopover.vue's own position() (F8) rather than a new positioning
// dependency: below-left of the trigger, clamped into the viewport, flipped above on overflow.
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { getAnchorRect, tooltipState } from './state/tooltip';

const tipRef = ref<HTMLElement | null>(null);
const style = ref({ left: '0px', top: '0px' });

async function position(): Promise<void> {
  await nextTick();
  const el = tipRef.value;
  const anchor = getAnchorRect();
  if (!el || !anchor) return;
  const p = el.getBoundingClientRect();
  let left = anchor.left;
  let top = anchor.bottom + 4;
  if (left + p.width > window.innerWidth) left = Math.max(4, window.innerWidth - p.width - 4);
  if (top + p.height > window.innerHeight) top = Math.max(4, anchor.top - p.height - 4);
  style.value = { left: `${left}px`, top: `${top}px` };
}

// Re-measured on open and whenever the shown text changes (a disabled-reason string can change
// under an already-open tooltip without it closing first) — the anchor itself never moves while a
// tooltip is open (D6 closes on scroll), so only these two triggers can invalidate the placement.
watch(
  () => tooltipState.open,
  (open) => {
    if (open) void position();
  },
);
watch(
  () => tooltipState.text,
  () => {
    if (tooltipState.open) void position();
  },
);

function onResize(): void {
  if (tooltipState.open) void position();
}
onMounted(() => window.addEventListener('resize', onResize));
onUnmounted(() => window.removeEventListener('resize', onResize));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="tooltipState.open"
      :id="tooltipState.id ?? undefined"
      ref="tipRef"
      class="app-tooltip p-float"
      role="tooltip"
      data-testid="app-tooltip"
      :style="style"
    >
      {{ tooltipState.text }}
    </div>
  </Teleport>
</template>

<style scoped>
/* z-index 300: the first free rung above every other floating surface (F10's ladder tops out at
   200 for the context menu/autocomplete/dialog scrim) — all three can host a hinted control, so
   anything lower would reproduce the "hint swallowed by an open overlay" bug in a new form. */
.app-tooltip {
  position: fixed;
  z-index: 300;
  max-width: 320px;
  padding: var(--kira-s-2) var(--kira-s-3);
  color: var(--kira-fg);
  font-size: var(--kira-t-sm);
  line-height: 1.4;
  white-space: pre-wrap;
  /* The ground rule this whole phase exists to keep: a tooltip must never be able to eat the
     click it is describing. */
  pointer-events: none;
}
</style>
