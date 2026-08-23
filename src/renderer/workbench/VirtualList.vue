<script setup lang="ts" generic="T">
import { computed, onMounted, onUnmounted, ref } from 'vue';

const props = withDefaults(
  defineProps<{ items: readonly T[]; rowHeight: number; overscan?: number }>(),
  { overscan: 8 },
);

const containerRef = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportHeight = ref(0);
let resizeObserver: ResizeObserver | null = null;

function onScroll(): void {
  scrollTop.value = containerRef.value?.scrollTop ?? 0;
}

onMounted(() => {
  viewportHeight.value = containerRef.value?.clientHeight ?? 0;
  resizeObserver = new ResizeObserver(([entry]) => {
    if (entry) viewportHeight.value = entry.contentRect.height;
  });
  if (containerRef.value) resizeObserver.observe(containerRef.value);
});
onUnmounted(() => resizeObserver?.disconnect());

const startIndex = computed(() =>
  Math.max(0, Math.floor(scrollTop.value / props.rowHeight) - props.overscan),
);
const endIndex = computed(() =>
  Math.min(
    props.items.length,
    Math.ceil((scrollTop.value + viewportHeight.value) / props.rowHeight) + props.overscan,
  ),
);
const visible = computed(() =>
  props.items
    .slice(startIndex.value, endIndex.value)
    .map((item, i) => ({ item, index: startIndex.value + i })),
);
const topSpacer = computed(() => startIndex.value * props.rowHeight);
const bottomSpacer = computed(
  () => Math.max(0, props.items.length - endIndex.value) * props.rowHeight,
);

// Scrolls just enough to bring `index` into view — top-aligned if it's above the viewport,
// bottom-aligned if below, a no-op if already visible. Used by the tab menu's "Reveal in
// project panel" (Step 7b); adds no behaviour for existing callers.
function scrollToIndex(index: number): void {
  const el = containerRef.value;
  if (!el) return;
  const rowTop = index * props.rowHeight;
  const rowBottom = rowTop + props.rowHeight;
  if (rowTop < el.scrollTop) {
    el.scrollTop = rowTop;
  } else if (rowBottom > el.scrollTop + el.clientHeight) {
    el.scrollTop = rowBottom - el.clientHeight;
  }
}

defineExpose({ scrollToIndex });
</script>

<template>
  <div ref="containerRef" class="virtual-list" data-testid="virtual-list" @scroll="onScroll">
    <!-- Sticky, not fixed: it stays in normal flow (so scrollTop-based indexing below is only
         off by its own height, well inside the default overscan) while visually pinning during
         vertical scroll — the console result grid's header row (§8.14) is the only caller that
         passes this slot; the two pre-existing single-column callers render nothing here. -->
    <div v-if="$slots.header" class="virtual-list-header">
      <slot name="header" />
    </div>
    <div :style="{ height: `${topSpacer}px` }" />
    <template v-for="row in visible" :key="row.index">
      <slot :item="row.item" :index="row.index" />
    </template>
    <div :style="{ height: `${bottomSpacer}px` }" />
  </div>
</template>

<style scoped>
.virtual-list {
  height: 100%;
  overflow: auto;
}

.virtual-list-header {
  position: sticky;
  top: 0;
  z-index: 1;
}
</style>
