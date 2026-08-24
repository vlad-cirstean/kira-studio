<script setup lang="ts" generic="T">
import { computed, onMounted, onUnmounted, ref } from 'vue';

// P27 D18: `rowHeights`, when present, replaces the uniform `scrollTop / rowHeight` math below
// with prefix-sum offsets and a binary search — document rows have a collapsed head and an
// expanded body that differ by an order of magnitude, so no single `rowHeight` can serve both.
// Without it this file behaves byte-for-byte as it always has: every existing caller (ProjectTree,
// OperationsPanel, both ConsoleResultGrid branches) is the regression guard for that claim.
const props = withDefaults(
  defineProps<{
    items: readonly T[];
    rowHeight: number;
    overscan?: number;
    rowHeights?: readonly number[];
  }>(),
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

// offsets[i] = the pixel top of row i; offsets[n] = the total content height. One array shared by
// startIndex/endIndex/topSpacer/bottomSpacer/scrollToIndex below, recomputed only when the caller
// hands in a new `rowHeights` array (it is the caller's job to keep that array in sync with its
// own row-height-affecting state — documentRows.ts's `rowsVersion`, for one).
const offsets = computed<readonly number[] | null>(() => {
  const heights = props.rowHeights;
  if (!heights) return null;
  const out = new Array<number>(heights.length + 1);
  out[0] = 0;
  for (let i = 0; i < heights.length; i++) out[i + 1] = out[i] + heights[i];
  return out;
});

/** The largest row index whose top offset is `<= y`, clamped to a valid row index. */
function rowIndexAtOffset(offsetsArr: readonly number[], y: number): number {
  let lo = 0;
  let hi = offsetsArr.length - 2; // offsetsArr has rowCount + 1 entries
  if (hi < 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsetsArr[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const startIndex = computed(() => {
  const offsetsArr = offsets.value;
  if (offsetsArr) {
    return Math.max(0, rowIndexAtOffset(offsetsArr, scrollTop.value) - props.overscan);
  }
  return Math.max(0, Math.floor(scrollTop.value / props.rowHeight) - props.overscan);
});
const endIndex = computed(() => {
  const offsetsArr = offsets.value;
  if (offsetsArr) {
    const bottom = scrollTop.value + viewportHeight.value;
    return Math.min(props.items.length, rowIndexAtOffset(offsetsArr, bottom) + 1 + props.overscan);
  }
  return Math.min(
    props.items.length,
    Math.ceil((scrollTop.value + viewportHeight.value) / props.rowHeight) + props.overscan,
  );
});
const visible = computed(() =>
  props.items
    .slice(startIndex.value, endIndex.value)
    .map((item, i) => ({ item, index: startIndex.value + i })),
);
const topSpacer = computed(() => {
  const offsetsArr = offsets.value;
  if (offsetsArr) return offsetsArr[startIndex.value] ?? 0;
  return startIndex.value * props.rowHeight;
});
const bottomSpacer = computed(() => {
  const offsetsArr = offsets.value;
  if (offsetsArr) {
    const total = offsetsArr[offsetsArr.length - 1];
    const endOffset = offsetsArr[endIndex.value] ?? total;
    return Math.max(0, total - endOffset);
  }
  return Math.max(0, props.items.length - endIndex.value) * props.rowHeight;
});

// Scrolls just enough to bring `index` into view — top-aligned if it's above the viewport,
// bottom-aligned if below, a no-op if already visible. Used by the tab menu's "Reveal in
// project panel" (Step 7b) and, with `rowHeights` set, the document view's go-to-match (P27 D8).
function scrollToIndex(index: number): void {
  const el = containerRef.value;
  if (!el) return;
  const offsetsArr = offsets.value;
  const rowTop = offsetsArr ? (offsetsArr[index] ?? 0) : index * props.rowHeight;
  const rowH = offsetsArr ? (props.rowHeights?.[index] ?? props.rowHeight) : props.rowHeight;
  const rowBottom = rowTop + rowH;
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
