<script setup lang="ts" generic="T extends { key: string }">
import { useVirtualRows, VIRTUAL_ROW_CLASS } from '@workbench/util/virtualRows';
import { ref } from 'vue';

const props = withDefaults(defineProps<{ rows: readonly T[]; rowHeight?: number; rowHeights?: readonly number[]; testid?: string }>(), {
  rowHeight: 28,
  testid: 'docker-list',
});

defineSlots<{ row(props: { row: T }): unknown }>();

const scrollEl = ref<HTMLElement | null>(null);
const { virtualItems, totalSize, onScroll } = useVirtualRows({
  count: () => props.rows.length,
  rowHeight: () => props.rowHeight,
  rowHeights: () => props.rowHeights,
  scrollElement: scrollEl,
});
</script>

<template>
  <div ref="scrollEl" role="listbox" class="min-h-0 flex-1 overflow-auto" :data-testid="testid" @scroll="onScroll">
    <div class="relative" :style="{ height: `${totalSize}px` }">
      <div
        v-for="vi in virtualItems"
        :key="String(vi.key)"
        :class="VIRTUAL_ROW_CLASS"
        :style="{ height: `${vi.size}px`, transform: `translateY(${vi.start}px)` }"
      >
        <slot name="row" :row="rows[vi.index]!" />
      </div>
    </div>
  </div>
</template>
