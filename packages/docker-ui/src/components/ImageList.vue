<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { rowIndent, rowVariants } from '@theme/components/rowVariants';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Badge } from '@theme/components/ui/badge';
import { t } from '@theme/i18n';
import { cn } from '@theme/lib/utils';
import { formatBytes } from '@workbench/behaviour/format';
import { compareNatural, matchesQuery } from '@workbench/behaviour/match';
import QueryState from '@workbench/components/QueryState.vue';
import { computed } from 'vue';
import { useDocker } from '../context';
import { shortId } from '../lib/format';
import { useImages } from '../queries';
import { useDockerUiStore } from '../state/dockerUi';
import ListState from './ListState.vue';
import VirtualList from './VirtualList.vue';

const ui = useDockerUiStore();
const docker = useDocker();
const images = useImages();

const rows = computed(() => {
  return (images.data.value ?? [])
    .filter((i) => matchesQuery(i.id, ui.search) || i.tags.some((t) => matchesQuery(t, ui.search)))
    .map((image) => ({ key: image.id, image, title: image.tags[0] ?? '<none>' }))
    .sort((a, b) => compareNatural(a.title, b.title));
});

function open(row: { image: { id: string } }): void {
  ui.select({ kind: 'image', id: row.image.id });
}

function openRegistry(url: string): void {
  void docker.openExternal(url);
}
</script>

<template>
  <QueryState :query="images" :is-empty="() => rows.length === 0">
    <template #empty>
      <ListState
        icon="package"
        :title="ui.search.trim() ? t('common.state.noMatches.empty') : t('docker.image.none.empty')"
        :hint="ui.search.trim() ? t('docker.image.noMatches.emptyHint') : t('docker.image.none.emptyHint')"
      />
    </template>
  <VirtualList :rows="rows" testid="docker-image-list" :open="open">
    <template #row="{ row, nav }">
      <!-- biome-ignore lint/a11y/useKeyWithClickEvents: Enter comes from useListNavigation on the container. -->
      <!-- biome-ignore lint/a11y/useFocusableInteractive: tabindex comes from the row props. -->
      <div
        :class="
          cn(
            rowVariants({ layout: 'tree', selected: ui.selection?.kind === 'image' && ui.selection.id === row.image.id }),
            'group/row h-full gap-1.5',
          )
        "
        :style="rowIndent(0)"
        data-testid="docker-row"
        :data-id="row.image.id"
        role="option"
        :aria-selected="ui.selection?.kind === 'image' && ui.selection.id === row.image.id"
        v-bind="nav"
        @click="open(row)"
      >
        <CodiconIcon name="package" :size="13" class="shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
          {{ row.title }}
          <span v-if="row.image.tags.length > 1" class="text-kira-sm text-muted-foreground">+{{ row.image.tags.length - 1 }}</span>
          <span v-if="row.image.dangling" class="font-data text-kira-sm text-muted-foreground">{{ shortId(row.image.id) }}</span>
        </span>
        <span class="flex w-6 shrink-0 justify-center"><Badge v-if="row.image.containers > 0" variant="count">{{ row.image.containers }}</Badge></span>
        <span class="w-14 shrink-0 text-right font-data text-kira-sm text-muted-foreground">{{ formatBytes(row.image.size) }}</span>
        <span class="flex w-6 shrink-0 justify-center">
          <TooltipIconButton
            v-if="row.image.registryUrl"
            icon="link-external"
            :label="t('docker.detail.openRegistry.tooltip')"
            class="hidden group-hover/row:flex group-focus-within/row:flex"
            data-testid="docker-image-registry"
            @click.stop="openRegistry(row.image.registryUrl)"
          />
        </span>
      </div>
    </template>
  </VirtualList>
  </QueryState>
</template>
