<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import EmptyState from '@theme/components/EmptyState.vue';
import HighlightedText from '@theme/components/HighlightedText.vue';
import { tableHeadClass, tableHeadRowClass, tableRowClass } from '@theme/components/ui/table';
import { t } from '@theme/i18n';
import { rowVariants } from '@theme/lib/rowVariants';
import { cn } from '@theme/lib/utils';
import { useListNavigation } from '@workbench/behaviour/listNavigation';
import { compareNatural, matchesQuery, splitMatches } from '@workbench/behaviour/match';
import { useVirtualRows, VIRTUAL_ROW_CLASS } from '@workbench/behaviour/virtualRows';
import { useRowHeight } from '@workbench/lib/rowHeight';
import { computed, ref } from 'vue';
import { useKubernetesUiStore } from '../state';
import type { KubeList, KubeRow } from '../wire';

const props = defineProps<{ data: KubeList }>();

const ui = useKubernetesUiStore();
const { single: rowHeight } = useRowHeight();

const sortBy = ref<{ index: number; dir: 1 | -1 } | null>(null);
const needle = computed(() => ui.listFilter.trim().toLowerCase());

const rows = computed(() => {
  const filtered = props.data.rows.filter((r) => matchesQuery(r.cells.join('\n'), ui.listFilter));
  const sort = sortBy.value;
  if (!sort) return filtered;
  return [...filtered].sort(
    (a, b) => sort.dir * compareNatural(a.cells[sort.index] ?? '', b.cells[sort.index] ?? ''),
  );
});

function toggleSort(index: number): void {
  const cur = sortBy.value;
  sortBy.value =
    cur?.index !== index ? { index, dir: 1 } : cur.dir === 1 ? { index, dir: -1 } : null;
}

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${props.data.columns.length}, minmax(5rem, 1fr))`,
}));

const refKey = (r: KubeRow): string => `${r.namespace}/${r.name}`;
function isSelected(r: KubeRow): boolean {
  return ui.selected?.name === r.name && ui.selected.namespace === r.namespace;
}

const scrollEl = ref<HTMLElement | null>(null);
const activeKey = ref<string | null>(null);
const activeIndex = computed(() => rows.value.findIndex((r) => refKey(r) === activeKey.value));
const { virtualItems, totalSize, onScroll, scrollToIndex } = useVirtualRows({
  count: () => rows.value.length,
  rowHeight: () => rowHeight.value,
  scrollElement: scrollEl,
  pinned: () => (activeIndex.value < 0 ? null : activeIndex.value),
});
const nav = useListNavigation<KubeRow>({
  container: scrollEl,
  items: () => rows.value,
  key: refKey,
  activeKey,
  onSelect: (r) => ui.selectRow({ namespace: r.namespace, name: r.name }),
  onOpen: (r) => ui.selectRow({ namespace: r.namespace, name: r.name }),
  scrollToIndex: (index) => scrollToIndex(index),
  rendered: () => virtualItems.value,
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" data-testid="kube-table">
    <EmptyState
      v-if="data.rows.length === 0"
      fill
      data-testid="kube-list-empty"
      icon="symbol-misc"
      :title="t('kubernetes.list.empty.empty')"
      :description="t('kubernetes.list.emptyHint.emptyHint')"
    />
    <EmptyState
      v-else-if="rows.length === 0"
      fill
      data-testid="kube-list-no-match"
      :title="t('common.state.noMatches.empty')"
    />
    <template v-else>
      <div
        :class="cn(tableHeadRowClass, tableHeadClass, 'grid shrink-0 items-center gap-x-3 px-3')"
        :style="gridStyle"
        data-testid="kube-table-head"
      >
        <button
          v-for="(col, i) in data.columns"
          :key="col.name"
          type="button"
          class="flex min-w-0 cursor-default items-center gap-1 border-0 bg-transparent p-0 text-left font-inherit text-inherit"
          :data-testid="`kube-sort-${col.name}`"
          @click="toggleSort(i)"
        >
          <span class="truncate">{{ col.name }}</span>
          <CodiconIcon
            v-if="sortBy?.index === i"
            :name="sortBy.dir === 1 ? 'arrow-up' : 'arrow-down'"
            :size="12"
          />
        </button>
      </div>
      <div
        ref="scrollEl"
        role="listbox"
        class="min-h-0 flex-1 overflow-auto"
        data-testid="kube-rows"
        @scroll="onScroll"
      >
        <div class="relative" :style="{ height: `${totalSize}px` }">
          <!-- biome-ignore lint/a11y/useKeyWithClickEvents: Enter comes from useListNavigation on the container. -->
          <div
            v-for="vi in virtualItems"
            :key="refKey(rows[vi.index]!)"
            :class="cn(tableRowClass, rowVariants({ layout: 'tree', selected: isSelected(rows[vi.index]!) }), VIRTUAL_ROW_CLASS, 'grid gap-x-3 px-3')"
            :style="{ ...gridStyle, height: `${vi.size}px`, transform: `translateY(${vi.start}px)` }"
            role="option"
            :aria-selected="isSelected(rows[vi.index]!)"
            data-testid="kube-row"
            :data-name="rows[vi.index]!.name"
            :data-namespace="rows[vi.index]!.namespace"
            v-bind="nav.rowProps(refKey(rows[vi.index]!))"
            :tabindex="nav.tabindexFor(refKey(rows[vi.index]!))"
            @click="ui.selectRow({ namespace: rows[vi.index]!.namespace, name: rows[vi.index]!.name })"
          >
            <span v-for="(cell, ci) in rows[vi.index]!.cells" :key="ci" class="min-w-0 truncate"
              ><HighlightedText :parts="splitMatches(cell, needle)" /></span
            >
          </div>
        </div>
      </div>
      <div
        v-if="data.truncated"
        class="shrink-0 border-t border-border bg-chrome px-2 py-0.5 text-kira-sm text-muted-foreground"
        data-testid="kube-truncated"
      >
        {{ t('kubernetes.list.truncated.status', { count: data.rows.length }) }}
      </div>
    </template>
  </div>
</template>
