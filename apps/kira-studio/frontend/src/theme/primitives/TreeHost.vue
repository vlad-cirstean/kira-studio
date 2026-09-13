<script setup lang="ts" generic="T extends StickyRowLike & { key: string }">
import { computed, ref } from 'vue';
import { STICKY_MAX_ROWS, type StickyRowLike, stickyBand, stickyInsetFor } from './stickyBand';
import VirtualList from './VirtualList.vue';

// P1 D3: the virtualized tree mechanics factored out of ProjectTree.vue — virtualization, the
// pinned ancestor band and reveal-scroll. What stays with the caller is the row model and the row
// itself (project/state/tree.ts, project/TreeRow.vue): this component knows nothing about
// connections, engines or openable kinds, only `depth`/`hasChildren`/`expanded`/`key`.
const props = withDefaults(
  defineProps<{
    rows: readonly T[];
    rowHeight: number;
    selectedKey?: string | null;
  }>(),
  { selectedKey: null },
);

const emit = defineEmits<{
  'background-contextmenu': [MouseEvent];
}>();

const virtualListRef = ref<{ scrollToIndex: (index: number, inset?: number) => void } | null>(null);

// Published by VirtualList's own scrollstate emit — the band's geometry lives here since this is
// the one primitive that understands what an ancestor is (ProjectTree.vue used to, P28 D2).
const scrollTop = ref(0);
const viewportHeight = ref(0);
function onScrollState(state: { scrollTop: number; viewportHeight: number }): void {
  scrollTop.value = state.scrollTop;
  viewportHeight.value = state.viewportHeight;
}

// D5: three rows, further clamped so a deliberately short panel never spends more of its own
// height on the band than it has rows to spare.
const stickyMaxRows = computed(() =>
  Math.max(0, Math.min(STICKY_MAX_ROWS, Math.floor(viewportHeight.value / props.rowHeight) - 2)),
);

const band = computed(() =>
  stickyBand(props.rows, scrollTop.value, props.rowHeight, stickyMaxRows.value),
);

// A caller sets its own pending-reveal key, waits a tick for its rows to reflect any expansion,
// then calls this — the animation-frame wait, the index lookup, the band inset and the scroll all
// live here since they all depend on this component's own geometry (today ProjectTree.vue:85-96).
async function revealKey(key: string): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const index = props.rows.findIndex((row) => row.key === key);
  if (index < 0) return;
  const inset = stickyInsetFor(props.rows, index, props.rowHeight, stickyMaxRows.value);
  virtualListRef.value?.scrollToIndex(index, inset);
}

function onBackgroundContextMenu(event: MouseEvent): void {
  // The row component stops propagation on its own contextmenu handler, so only a right-click on
  // the empty area below/around the rows (the virtual list's spacer divs) ever reaches here.
  emit('background-contextmenu', event);
}

defineExpose({ revealKey });
</script>

<template>
  <div class="tree-host" data-testid="tree-background" @contextmenu.prevent="onBackgroundContextMenu">
    <VirtualList ref="virtualListRef" :items="rows" :row-height="rowHeight" @scrollstate="onScrollState">
      <template #default="{ item }">
        <slot name="row" :row="item" :sticky="false" />
      </template>
      <template #sticky>
        <div data-testid="tree-sticky-band">
          <template v-for="slot in band" :key="slot.row.key">
            <slot name="row" :row="slot.row" :sticky="true" :top="slot.top" />
          </template>
        </div>
      </template>
    </VirtualList>
  </div>
</template>

<style scoped>
.tree-host {
  height: 100%;
}
</style>
