<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { rowIndent, rowVariants } from '@theme/components/rowVariants';
import { Badge } from '@theme/components/ui/badge';
import { cn } from '@theme/lib/utils';
import { computed } from 'vue';
import { useVolumes } from '../queries';
import { useDockerUiStore } from '../state/dockerUi';
import ListState from './ListState.vue';
import VirtualList from './VirtualList.vue';

const ui = useDockerUiStore();
const volumes = useVolumes();

const rows = computed(() => {
  const q = ui.search.trim().toLowerCase();
  return (volumes.data.value ?? [])
    .filter((v) => q === '' || v.name.toLowerCase().includes(q))
    .map((volume) => ({ key: volume.name, volume }))
    .sort((a, b) => a.volume.name.localeCompare(b.volume.name));
});
</script>

<template>
  <ListState
    v-if="volumes.isPending.value || volumes.isError.value || rows.length === 0"
    :loading="volumes.isPending.value"
    :error="volumes.isError.value"
    icon="database"
    :empty-title="ui.search.trim() ? 'No matches' : 'No volumes'"
    :empty-hint="ui.search.trim() ? 'No volume matches the search.' : 'Containers create volumes for persistent data.'"
    @retry="volumes.refetch()"
  />
  <VirtualList v-else :rows="rows" testid="docker-volume-list">
    <template #row="{ row }">
      <div
        :class="
          cn(
            rowVariants({ layout: 'tree', selected: ui.selection?.kind === 'volume' && ui.selection.id === row.volume.name }),
            'group/row h-full gap-1.5',
          )
        "
        :style="rowIndent(0)"
        data-testid="docker-row"
        :data-id="row.volume.name"
        role="option"
        :aria-selected="ui.selection?.kind === 'volume' && ui.selection.id === row.volume.name"
        tabindex="0"
        @click="ui.select({ kind: 'volume', id: row.volume.name })"
        @keydown.enter="ui.select({ kind: 'volume', id: row.volume.name })"
      >
        <CodiconIcon name="database" :size="13" class="shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{{ row.volume.name }}</span>
        <span class="flex w-6 shrink-0 justify-center"><Badge v-if="row.volume.usedBy.length > 0" variant="count">{{ row.volume.usedBy.length }}</Badge></span>
        <span class="w-14 shrink-0 truncate text-right text-kira-sm text-muted-foreground">{{ row.volume.driver }}</span>
      </div>
    </template>
  </VirtualList>
</template>
