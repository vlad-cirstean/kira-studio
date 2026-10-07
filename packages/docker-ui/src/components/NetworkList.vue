<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Badge } from '@theme/components/ui/badge';
import { computed } from 'vue';
import { useNetworks } from '../queries';
import { useDockerUiStore } from '../state/dockerUi';
import VirtualList from './VirtualList.vue';

const ui = useDockerUiStore();
const networks = useNetworks();

const rows = computed(() => {
  const q = ui.search.trim().toLowerCase();
  return (networks.data.value ?? [])
    .filter((n) => q === '' || n.name.toLowerCase().includes(q))
    .map((network) => ({ key: network.id, network }))
    .sort((a, b) => a.network.name.localeCompare(b.network.name));
});
</script>

<template>
  <VirtualList :rows="rows" testid="docker-network-list">
    <template #row="{ row }">
      <div
        class="flex h-full items-center gap-1 px-1.5 cursor-default select-none"
        :class="ui.selection?.kind === 'network' && ui.selection.id === row.network.id ? 'bg-select' : 'hover:bg-hover'"
        data-testid="docker-row"
        :data-id="row.network.id"
        role="option"
        :aria-selected="ui.selection?.kind === 'network' && ui.selection.id === row.network.id"
        tabindex="0"
        @click="ui.select({ kind: 'network', id: row.network.id })"
        @keydown.enter="ui.select({ kind: 'network', id: row.network.id })"
      >
        <CodiconIcon name="globe" :size="13" class="shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{{ row.network.name }}</span>
        <Badge v-if="row.network.containers > 0" variant="count">{{ row.network.containers }}</Badge>
        <span class="shrink-0 text-kira-sm text-muted-foreground">{{ row.network.driver }}</span>
      </div>
    </template>
  </VirtualList>
</template>
