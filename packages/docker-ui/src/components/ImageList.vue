<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Badge } from '@theme/components/ui/badge';
import { formatBytes } from '@workbench/util/format';
import { computed } from 'vue';
import { shortId } from '../lib/format';
import { useImages } from '../queries';
import { useDockerUiStore } from '../state/dockerUi';
import VirtualList from './VirtualList.vue';

const ui = useDockerUiStore();
const images = useImages();

const rows = computed(() => {
  const q = ui.search.trim().toLowerCase();
  return (images.data.value ?? [])
    .filter((i) => q === '' || i.tags.some((t) => t.toLowerCase().includes(q)) || i.id.includes(q))
    .map((image) => ({ key: image.id, image, title: image.tags[0] ?? '<none>' }))
    .sort((a, b) => a.title.localeCompare(b.title));
});
</script>

<template>
  <VirtualList :rows="rows" testid="docker-image-list">
    <template #row="{ row }">
      <div
        class="flex h-full items-center gap-1 px-1.5 cursor-default select-none"
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
        <Badge v-if="row.image.containers > 0" variant="count">{{ row.image.containers }}</Badge>
        <span class="shrink-0 text-kira-sm text-muted-foreground">{{ formatBytes(row.image.size) }}</span>
      </div>
    </template>
  </VirtualList>
</template>
