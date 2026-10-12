<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { rowIndent, rowVariants } from '@theme/components/rowVariants';
import { Badge } from '@theme/components/ui/badge';
import { t } from '@theme/i18n';
import { cn } from '@theme/lib/utils';
import { compareNatural, matchesQuery } from '@workbench/behaviour/match';
import QueryState from '@workbench/components/QueryState.vue';
import { computed } from 'vue';
import { useVolumes } from '../queries';
import { useDockerUiStore } from '../state/dockerUi';
import ListState from './ListState.vue';
import VirtualList from './VirtualList.vue';

const ui = useDockerUiStore();
const volumes = useVolumes();

const rows = computed(() => {
  return (volumes.data.value ?? [])
    .filter((v) => matchesQuery(v.name, ui.search))
    .map((volume) => ({ key: volume.name, volume }))
    .sort((a, b) => compareNatural(a.volume.name, b.volume.name));
});

function open(row: { volume: { name: string } }): void {
  ui.select({ kind: 'volume', id: row.volume.name });
}
</script>

<template>
  <QueryState :query="volumes" :is-empty="() => rows.length === 0">
    <template #empty>
      <ListState
        icon="database"
        :title="ui.search.trim() ? t('common.state.noMatches.empty') : t('docker.volume.none.empty')"
        :hint="ui.search.trim() ? t('docker.volume.noMatches.emptyHint') : t('docker.volume.none.emptyHint')"
      />
    </template>
    <VirtualList :rows="rows" testid="docker-volume-list" :open="open">
      <template #row="{ row, nav }">
        <!-- biome-ignore lint/a11y/useKeyWithClickEvents: Enter comes from useListNavigation on the container. -->
        <!-- biome-ignore lint/a11y/useFocusableInteractive: tabindex comes from the row props. -->
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
          v-bind="nav"
          @click="open(row)"
        >
          <CodiconIcon name="database" :size="13" class="shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{{
            row.volume.name
          }}</span>
          <span class="flex w-6 shrink-0 justify-center"
            ><Badge v-if="row.volume.usedBy.length > 0" variant="count">{{
              row.volume.usedBy.length
            }}</Badge></span
          >
          <span class="w-14 shrink-0 truncate text-right text-kira-sm text-muted-foreground">{{
            row.volume.driver
          }}</span>
        </div>
      </template>
    </VirtualList>
  </QueryState>
</template>
