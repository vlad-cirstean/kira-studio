<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Badge } from '@theme/components/ui/badge';
import { computed } from 'vue';
import { useNetworks } from '../queries';
import { useDockerUiStore } from '../state/dockerUi';
import ListState from './ListState.vue';
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
  <ListState
    v-if="networks.isPending.value || networks.isError.value || rows.length === 0"
    :loading="networks.isPending.value"
    :error="networks.isError.value"
    icon="globe"
    :empty-title="ui.search.trim() ? 'No matches' : 'No networks'"
    :empty-hint="ui.search.trim() ? 'No network matches the search.' : undefined"
    @retry="networks.refetch()"
  />
  <VirtualList v-else :rows="rows" testid="docker-network-list">
    <template #row="{ row }">
      <div
        class="group/row flex h-full cursor-default select-none items-center gap-1.5 px-1.5 outline-none focus-visible:outline focus-visible:-outline-offset-1 focus-visible:outline-focus"
        :class="ui.selection?.kind === 'network' && ui.selection.id === row.network.id ? 'bg-select shadow-[inset_2px_0_0_var(--color-focus)]' : 'hover:bg-hover'"
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
        <span class="flex w-6 shrink-0 justify-center"><Badge v-if="row.network.containers > 0" variant="count">{{ row.network.containers }}</Badge></span>
        <span class="w-14 shrink-0 truncate text-right text-kira-sm text-muted-foreground">{{ row.network.driver }}</span>
      </div>
    </template>
  </VirtualList>
</template>
