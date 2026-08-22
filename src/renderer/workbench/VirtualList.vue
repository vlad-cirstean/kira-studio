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
</script>

<template>
  <div ref="containerRef" class="virtual-list" data-testid="virtual-list" @scroll="onScroll">
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
  overflow-y: auto;
  overflow-x: hidden;
}
</style>
