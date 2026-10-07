<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Badge } from '@theme/components/ui/badge';
import { computed } from 'vue';
import { useVolumes } from '../queries';
import { useDockerUiStore } from '../state/dockerUi';
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
  <VirtualList :rows="rows" testid="docker-volume-list">
    <template #row="{ row }">
      <div
        class="flex h-full items-center gap-1 px-1.5 cursor-default select-none"
        :class="ui.selection?.kind === 'volume' && ui.selection.id === row.volume.name ? 'bg-select' : 'hover:bg-hover'"
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
        <Badge v-if="row.volume.usedBy.length > 0" variant="count">{{ row.volume.usedBy.length }}</Badge>
        <span class="shrink-0 text-kira-sm text-muted-foreground">{{ row.volume.driver }}</span>
      </div>
    </template>
  </VirtualList>
</template>
