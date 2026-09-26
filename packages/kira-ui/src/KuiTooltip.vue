<script setup lang="ts">
// G20 D2: the floating element half of `tooltip.ts`'s controller — mounted once per host document
// (`packages/git-ui/src/App.vue`'s graph panel, `ReviewView.vue`'s sidebar), each independent —
// see `tooltip.ts`'s own doc comment for why. Placement mirrors `AppTooltip.vue`'s own shape:
// `floatingPosition.ts`'s default `computeFloatPosition` (below-left of the trigger, clamped into
// the viewport, flipped above on overflow).
//
// P110 A6: controls.css's `.kui-tooltip` replaced by `kv:` utilities. `kv:max-w-80` is the default
// numeric spacing scale (320px = 80 × the kept 4px `--spacing` step, rung 1, §1.1), not a new
// token. P110 I2-28: `kv:leading-[1.4]` becomes `kv:leading-snug` (Tailwind's default 1.375 --
// 0.025 off, well under a visually-equivalent margin).
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
      class="kv:fixed kv:z-[var(--kui-z-tooltip,40)] kv:max-w-80 kv:py-1 kv:px-1.5 kv:bg-kui-bg-panel kv:text-kui-fg kv:border kv:border-kui-border-strong kv:rounded-kui-float kv:shadow-kui-float kv:text-kui-base kv:leading-snug kv:whitespace-pre-wrap kv:pointer-events-none"
      role="tooltip"
      data-testid="kui-tooltip"
      :style="style"
    >
      {{ tooltipState.text }}
    </div>
  </Teleport>
</template>
