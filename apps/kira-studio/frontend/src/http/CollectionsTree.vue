<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { settingsState } from '../state/settings';
import TreeHost from '../theme/primitives/TreeHost.vue';
import CollectionRow from './CollectionRow.vue';
import {
  type CollectionRowVm,
  collapseRow,
  collectionsState,
  expandRow,
  initCollections,
  selectRow,
  toggleRow,
  visibleRows,
} from './state/collections';

// P4 D13: a real TreeHost consumer, with **not one line of tree mechanics** of its own —
// virtualization, the pinned ancestor band and reveal-scroll all live in the primitive P1 factored
// out for exactly this. If any of TreeHost's props turned out to need widening here, that would be
// a signal the row model was wrong; none did.
const rowHeight = computed(() => (settingsState.appearance.rowDensity === 'compact' ? 22 : 28));
const treeHostRef = ref<{ revealKey: (key: string) => Promise<void> } | null>(null);

onMounted(initCollections);

/** Called by the panel after a mutation adds a row worth scrolling to. */
async function reveal(key: string): Promise<void> {
  await treeHostRef.value?.revealKey(key);
}
defineExpose({ reveal });

function onSelect(row: CollectionRowVm): void {
  selectRow(row.key);
}

// The twisty always expands/collapses; unlike Studio's tree there is no adapter call behind it and
// no synthetic group row to special-case (F15) — the whole tree is already in memory.
function onToggle(row: CollectionRowVm): void {
  toggleRow(row);
}

// A collection and a folder toggle on double-click; a request opens, which C6 wires.
function onOpen(row: CollectionRowVm): void {
  if (row.kind === 'request') return;
  toggleRow(row);
}

// The same shape ProjectTree.vue has, over the existing tree.* shortcut ids (§3) — plus the
// arrow keys, which are collapse/expand rather than a menu action and so dispatch directly.
function onTreeKeydown(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.isComposing) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest('input, textarea, [contenteditable="true"]')) return;
  const row = visibleRows.value.find((r) => r.key === collectionsState.selected);
  if (!row) return;

  if (e.key === 'ArrowRight') {
    e.preventDefault();
    expandRow(row);
    return;
  }
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    collapseRow(row);
    return;
  }
}
</script>

<template>
  <TreeHost
    ref="treeHostRef"
    class="collections-tree"
    :rows="visibleRows"
    :row-height="rowHeight"
    :selected-key="collectionsState.selected"
    @keydown="onTreeKeydown"
  >
    <template #row="{ row, sticky, top }">
      <CollectionRow
        :class="{ 'sticky-row': sticky }"
        :style="sticky ? { top: `${top}px`, height: `${rowHeight}px` } : undefined"
        :row="row"
        :selected="collectionsState.selected === row.key"
        :sticky="sticky"
        @select="onSelect"
        @toggle="onToggle"
        @open="onOpen"
      />
    </template>
  </TreeHost>
</template>

<style scoped>
.collections-tree {
  height: 100%;
}

/* Positioned relative to VirtualList's own zero-height .virtual-list-sticky, exactly as
   ProjectTree.vue's own sticky row is — opaque and full-width so it fully occludes whatever real
   row has scrolled up behind it. */
.sticky-row {
  position: absolute;
  left: 0;
  right: 0;
  background: var(--kira-bg);
  z-index: 1;
}
</style>
