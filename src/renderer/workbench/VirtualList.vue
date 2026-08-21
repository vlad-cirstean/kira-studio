<script setup lang="ts" generic="T">
import { computed, onMounted, onUnmounted, ref } from 'vue';

// Fixed-row-height windowing (§2.1). No IntersectionObserver, no library. Used by the project tree
// and the operations panel.

const props = withDefaults(
  defineProps<{ items: readonly T[]; rowHeight: number; overscan?: number }>(),
  { overscan: 8 },
);

defineSlots<{ default(props: { item: T; index: number }): unknown }>();

const viewport = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportHeight = ref(0);

let observer: ResizeObserver | null = null;

onMounted(() => {
  const el = viewport.value;
  if (!el) return;
  viewportHeight.value = el.clientHeight;
  observer = new ResizeObserver(() => {
    viewportHeight.value = el.clientHeight;
  });
  observer.observe(el);
});

onUnmounted(() => observer?.disconnect());

const startIndex = computed(() =>
  Math.max(0, Math.floor(scrollTop.value / props.rowHeight) - props.overscan),
);

const endIndex = computed(() =>
  Math.min(
    props.items.length,
    Math.ceil((scrollTop.value + viewportHeight.value) / props.rowHeight) + props.overscan,
  ),
);

const visible = computed(() => {
  const out: Array<{ item: T; index: number }> = [];
  for (let i = startIndex.value; i < endIndex.value; i += 1) {
    out.push({ item: props.items[i], index: i });
  }
  return out;
});

const topPad = computed(() => startIndex.value * props.rowHeight);
const bottomPad = computed(() =>
  Math.max(0, (props.items.length - endIndex.value) * props.rowHeight),
);

function onScroll(e: Event): void {
  scrollTop.value = (e.target as HTMLElement).scrollTop;
}
</script>

<template>
  <div ref="viewport" class="virtual-list" @scroll.passive="onScroll">
    <div :style="{ height: `${topPad}px` }" />
    <template v-for="row in visible" :key="row.index">
      <slot :item="row.item" :index="row.index" />
    </template>
    <div :style="{ height: `${bottomPad}px` }" />
  </div>
</template>

<style scoped>
.virtual-list {
  height: 100%;
  overflow-y: auto;
}
</style>
