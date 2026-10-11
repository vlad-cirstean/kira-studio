<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { rowIndent, rowVariants } from '@theme/components/rowVariants';
import { Badge } from '@theme/components/ui/badge';
import { t } from '@theme/i18n';
import { cn } from '@theme/lib/utils';
import { compareNatural, matchesQuery } from '@workbench/behaviour/match';
import QueryState from '@workbench/components/QueryState.vue';
import { computed } from 'vue';
import { useNetworks } from '../queries';
import { useDockerUiStore } from '../state/dockerUi';
import ListState from './ListState.vue';
import VirtualList from './VirtualList.vue';

const ui = useDockerUiStore();
const networks = useNetworks();

const rows = computed(() => {
  return (networks.data.value ?? [])
    .filter((n) => matchesQuery(n.name, ui.search))
    .map((network) => ({ key: network.id, network }))
    .sort((a, b) => compareNatural(a.network.name, b.network.name));
});

function open(row: { network: { id: string } }): void {
  ui.select({ kind: 'network', id: row.network.id });
}
</script>

<template>
  <QueryState :query="networks" :is-empty="() => rows.length === 0">
    <template #empty>
      <ListState
        icon="globe"
        :title="ui.search.trim() ? t('common.state.noMatches.empty') : t('docker.network.none.empty')"
        :hint="ui.search.trim() ? t('docker.network.noMatches.emptyHint') : undefined"
      />
    </template>
  <VirtualList :rows="rows" testid="docker-network-list" :open="open">
    <template #row="{ row, nav }">
      <!-- biome-ignore lint/a11y/useKeyWithClickEvents: Enter comes from useListNavigation on the container. -->
      <!-- biome-ignore lint/a11y/useFocusableInteractive: tabindex comes from the row props. -->
      <div
        :class="
          cn(
            rowVariants({ layout: 'tree', selected: ui.selection?.kind === 'network' && ui.selection.id === row.network.id }),
            'group/row h-full gap-1.5',
          )
        "
        :style="rowIndent(0)"
        data-testid="docker-row"
        :data-id="row.network.id"
        role="option"
        :aria-selected="ui.selection?.kind === 'network' && ui.selection.id === row.network.id"
        v-bind="nav"
        @click="open(row)"
      >
        <CodiconIcon name="globe" :size="13" class="shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{{ row.network.name }}</span>
        <span class="flex w-6 shrink-0 justify-center"><Badge v-if="row.network.containers > 0" variant="count">{{ row.network.containers }}</Badge></span>
        <span class="w-14 shrink-0 truncate text-right text-kira-sm text-muted-foreground">{{ row.network.driver }}</span>
      </div>
    </template>
  </VirtualList>
  </QueryState>
</template>
