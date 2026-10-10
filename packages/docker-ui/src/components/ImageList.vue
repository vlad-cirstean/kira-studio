<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Badge } from '@theme/components/ui/badge';
import { computed } from 'vue';
import { useDocker } from '../context';
import { formatSize, shortId } from '../lib/format';
import { useImages } from '../queries';
import { useDockerUiStore } from '../state/dockerUi';
import ListState from './ListState.vue';
import VirtualList from './VirtualList.vue';

const ui = useDockerUiStore();
const docker = useDocker();
const images = useImages();

const rows = computed(() => {
  const q = ui.search.trim().toLowerCase();
  return (images.data.value ?? [])
    .filter((i) => q === '' || i.tags.some((t) => t.toLowerCase().includes(q)) || i.id.includes(q))
    .map((image) => ({ key: image.id, image, title: image.tags[0] ?? '<none>' }))
    .sort((a, b) => a.title.localeCompare(b.title));
});

function openRegistry(url: string): void {
  void docker.openExternal(url).catch(() => undefined);
}
</script>

<template>
  <ListState
    v-if="images.isPending.value || images.isError.value || rows.length === 0"
    :loading="images.isPending.value"
    :error="images.isError.value"
    icon="package"
    :empty-title="ui.search.trim() ? 'No matches' : 'No images'"
    :empty-hint="ui.search.trim() ? 'No image matches the search.' : 'Pull one with docker pull.'"
    @retry="images.refetch()"
  />
  <VirtualList v-else :rows="rows" testid="docker-image-list">
    <template #row="{ row }">
      <div
        class="group/row flex h-full cursor-default select-none items-center gap-1.5 px-1.5 outline-none focus-visible:outline focus-visible:-outline-offset-1 focus-visible:outline-focus"
        :class="ui.selection?.kind === 'image' && ui.selection.id === row.image.id ? 'bg-select' : 'hover:bg-hover'"
        data-testid="docker-row"
        :data-id="row.image.id"
        role="option"
        :aria-selected="ui.selection?.kind === 'image' && ui.selection.id === row.image.id"
        tabindex="0"
        @click="ui.select({ kind: 'image', id: row.image.id })"
        @keydown.enter="ui.select({ kind: 'image', id: row.image.id })"
      >
        <CodiconIcon name="package" :size="13" class="shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
          {{ row.title }}
          <span v-if="row.image.tags.length > 1" class="text-kira-sm text-muted-foreground">+{{ row.image.tags.length - 1 }}</span>
          <span v-if="row.image.dangling" class="font-data text-kira-sm text-muted-foreground">{{ shortId(row.image.id) }}</span>
        </span>
        <span class="flex w-6 shrink-0 justify-center"><Badge v-if="row.image.containers > 0" variant="count">{{ row.image.containers }}</Badge></span>
        <span class="w-14 shrink-0 text-right font-data text-kira-sm text-muted-foreground">{{ formatSize(row.image.size) }}</span>
        <span class="flex w-6 shrink-0 justify-center">
          <TooltipIconButton
            v-if="row.image.registryUrl"
            icon="link-external"
            label="Open in registry"
            class="hidden group-hover/row:flex group-focus-within/row:flex"
            data-testid="docker-image-registry"
            @click.stop="openRegistry(row.image.registryUrl)"
          />
        </span>
      </div>
    </template>
  </VirtualList>
</template>
