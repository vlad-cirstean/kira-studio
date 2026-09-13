<script setup lang="ts">
// G20 D2: the floating element half of `tooltip.ts`'s controller — mounted once per host document
// (`packages/git-ui/src/App.vue`'s graph panel, `ReviewView.vue`'s sidebar), each independent —
// see `tooltip.ts`'s own doc comment for why. Placement mirrors `AppTooltip.vue`'s own shape:
// `floatingPosition.ts`'s default `computeFloatPosition` (below-left of the trigger, clamped into
// the viewport, flipped above on overflow).
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { computeFloatPosition } from './floatingPosition.ts';
import { getAnchorElement, tooltipState } from './tooltip.ts';

const tipRef = ref<HTMLElement | null>(null);
const style = ref({ left: '0px', top: '0px' });

// tooltip.ts's own onScroll closes the tooltip on any scroll, so the anchor never moves out from
// under an open tooltip and autoUpdate buys nothing here; only a resize can still invalidate a
// placement while one is open.
async function position(): Promise<void> {
  await nextTick();
  const el = tipRef.value;
  const anchor = getAnchorElement();
  if (!el || !anchor) return;
  const { left, top } = await computeFloatPosition(anchor, el);
  style.value = { left: `${left}px`, top: `${top}px` };
}

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
      class="kui-tooltip"
      role="tooltip"
      data-testid="kui-tooltip"
      :style="style"
    >
      {{ tooltipState.text }}
    </div>
  </Teleport>
</template>
