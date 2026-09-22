<script setup lang="ts">
// P22 D4/D5: the app-owned tooltip singleton, mounted once beside <ContextMenu /> in App.vue.
// P23: placement is theme/floatingPosition.ts's default computeFloatPosition() (below-left of
// the trigger, clamped into the viewport, flipped above on overflow) — the same call
// ErrorPopover.vue makes, replacing the two's former shared 'callout' strategy in the deleted
// anchoredPosition.ts.
import { useEventListener } from '@vueuse/core';
import { nextTick, ref, watch } from 'vue';
import { useTooltipStore } from '../state/tooltip';
import { computeFloatPosition } from '../util/floatingPosition';

const tooltipStore = useTooltipStore();
const tipRef = ref<HTMLElement | null>(null);
const style = ref({ left: '0px', top: '0px' });

// D6 (state/tooltip.ts's own onScroll) closes the tooltip on any scroll, so — unlike
// PopoverPanel/ErrorPopover — the anchor never moves out from under an open tooltip and autoUpdate
// buys nothing here; only a resize (below) can still invalidate a placement while one is open.
async function position(): Promise<void> {
  await nextTick();
  const el = tipRef.value;
  const anchor = tooltipStore.getAnchorElement();
  if (!el || !anchor) return;
  const { left, top } = await computeFloatPosition(anchor, el);
  style.value = { left: `${left}px`, top: `${top}px` };
}

// Re-measured on open and whenever the shown text changes (a disabled-reason string can change
// under an already-open tooltip without it closing first) — the anchor itself never moves while a
// tooltip is open (D6 closes on scroll), so only these two triggers can invalidate the placement.
watch(
  () => tooltipStore.open,
  (open) => {
    if (open) void position();
  },
);
watch(
  () => tooltipStore.text,
  () => {
    if (tooltipStore.open) void position();
  },
);

useEventListener(window, 'resize', () => {
  if (tooltipStore.open) void position();
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="tooltipStore.open"
      :id="tooltipStore.id ?? undefined"
      ref="tipRef"
      class="app-tooltip p-float"
      role="tooltip"
      data-testid="app-tooltip"
      :style="style"
    >
      <template v-if="tooltipStore.parts">
        <div class="tip-head">
          <span class="tip-title">{{ tooltipStore.parts.title }}</span>
          <span
            v-if="tooltipStore.parts.meta"
            class="tip-meta"
            :style="
              tooltipStore.parts.metaColor ? { color: tooltipStore.parts.metaColor } : undefined
            "
            >{{ tooltipStore.parts.meta }}</span
          >
        </div>
        <div v-if="tooltipStore.parts.body" class="tip-body">{{ tooltipStore.parts.body }}</div>
      </template>
      <template v-else>{{ tooltipStore.text }}</template>
    </div>
  </Teleport>
</template>

<style scoped>
@reference "@theme/base.css";

/* The top rung of theme/tokens.css's own floating-surface ladder (P28 D17(c)) — every other
   floating surface can host a hinted control, so anything lower would reproduce the "hint
   swallowed by an open overlay" bug in a new form. */
.app-tooltip {
  /* The ground rule this whole phase exists to keep: a tooltip must never be able to eat the
     click it is describing. */
  @apply fixed max-w-80 whitespace-pre-wrap pointer-events-none;
  z-index: var(--kira-z-tooltip);
  padding: var(--kira-s-2) var(--kira-s-3);
  color: var(--kira-fg);
  font-size: var(--kira-t-sm);
  line-height: 1.4;
}

/* P42 D19: the structured half — a bold name, a muted mono type badge beside it on the same
   line, and a description below as its own paragraph, so "what this is called" reads distinct
   from "what it holds" at a glance instead of running together in one block. .tip-title and
   .tip-meta are siblings (not nested) so each is independently queryable by its own text — a
   parent-child nesting would make .tip-title's own textContent include .tip-meta's. */
.tip-head {
  @apply flex items-baseline;
  gap: var(--kira-s-2);
}

.tip-title {
  @apply font-semibold;
}

/* (regression pass, task batch P46-6): a plain --kira-fg-muted span at --kira-t-xs read as
   near-invisible next to the bold title beside it — the one caller of `meta` (a column's data
   type) needs this to actually register at a glance, the same bar the cell editor's own type
   badge (CellEditorView.vue's `.p-badge`) already clears. A real pill — background, padding,
   rounded corners, bolder weight and a full step up in size — instead of a second, unstyled text
   run is what gets it there; `metaColor` (columnTypeColor, when set) colours the text against it. */
.tip-meta {
  @apply inline-flex items-center font-semibold shrink-0 rounded-kira-sm;
  height: var(--kira-h-xs);
  padding: 0 var(--kira-s-3);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  font-family: var(--kira-font-data);
  font-size: var(--kira-t-sm);
}

.tip-body {
  color: var(--kira-fg-muted);
  margin-top: var(--kira-s-1);
}
</style>
