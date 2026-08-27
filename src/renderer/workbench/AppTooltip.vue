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
      <template v-if="tooltipState.parts">
        <div class="tip-head">
          <span class="tip-title">{{ tooltipState.parts.title }}</span>
          <span
            v-if="tooltipState.parts.meta"
            class="tip-meta"
            :style="
              tooltipState.parts.metaColor ? { color: tooltipState.parts.metaColor } : undefined
            "
            >{{ tooltipState.parts.meta }}</span
          >
        </div>
        <div v-if="tooltipState.parts.body" class="tip-body">{{ tooltipState.parts.body }}</div>
      </template>
      <template v-else>{{ tooltipState.text }}</template>
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

/* P42 D19: the structured half — a bold name, a muted mono type badge beside it on the same
   line, and a description below as its own paragraph, so "what this is called" reads distinct
   from "what it holds" at a glance instead of running together in one block. .tip-title and
   .tip-meta are siblings (not nested) so each is independently queryable by its own text — a
   parent-child nesting would make .tip-title's own textContent include .tip-meta's. */
.tip-head {
  display: flex;
  align-items: baseline;
  gap: var(--kira-s-2);
}

.tip-title {
  font-weight: 600;
}

/* (regression pass, task batch P46-6): a plain --kira-fg-muted span at --kira-t-xs read as
   near-invisible next to the bold title beside it — the one caller of `meta` (a column's data
   type) needs this to actually register at a glance, the same bar the cell editor's own type
   badge (CellEditorView.vue's `.p-badge`) already clears. A real pill — background, padding,
   rounded corners, bolder weight and a full step up in size — instead of a second, unstyled text
   run is what gets it there; `metaColor` (columnTypeColor, when set) colours the text against it. */
.tip-meta {
  height: var(--kira-h-xs);
  display: inline-flex;
  align-items: center;
  padding: 0 var(--kira-s-3);
  border-radius: var(--kira-radius-sm);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  font-family: var(--kira-font-family);
  font-size: var(--kira-t-sm);
  font-weight: 600;
  flex-shrink: 0;
}

.tip-body {
  margin-top: var(--kira-s-1);
  color: var(--kira-fg-muted);
}
</style>
