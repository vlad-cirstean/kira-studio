<script setup lang="ts">
import { formatBytes } from '@workbench/util/format';
import { computed } from 'vue';
import { formatCreated, shortId } from '../lib/format';
import { useContainers, useImages, useInspect, useNetworks, useVolumes } from '../queries';
import { useDockerUiStore } from '../state/dockerUi';
import type { InspectKind } from '../wire';
import InspectView from './InspectView.vue';

const props = defineProps<{ kind: InspectKind; id: string }>();

const ui = useDockerUiStore();
const images = useImages();
const volumes = useVolumes();
const networks = useNetworks();
const containers = useContainers();
const inspect = useInspect(
  computed(() => props.kind),
  computed(() => props.id),
);

const image = computed(() => (images.data.value ?? []).find((i) => i.id === props.id));
const volume = computed(() => (volumes.data.value ?? []).find((v) => v.name === props.id));
const network = computed(() => (networks.data.value ?? []).find((n) => n.id === props.id));

const title = computed(() => {
  if (props.kind === 'image') return image.value?.tags[0] ?? shortId(props.id);
  if (props.kind === 'volume') return props.id;
  return network.value?.name ?? shortId(props.id);
});

const facts = computed<Array<[string, string]>>(() => {
  if (props.kind === 'image' && image.value) {
    const i = image.value;
    return [
      ['Tags', i.tags.join(', ') || '<none>'],
      ['ID', i.id],
      ['Size', formatBytes(i.size)],
      ['Created', formatCreated(i.created)],
    ];
  }
  if (props.kind === 'volume' && volume.value) {
    const v = volume.value;
    return [
      ['Driver', v.driver],
      ['Mountpoint', v.mountpoint],
      ['Scope', v.scope],
      ['Created', v.created || '-'],
      ...Object.entries(v.labels).map(([k, val]): [string, string] => [`Label ${k}`, val]),
    ];
  }
  if (props.kind === 'network' && network.value) {
    const n = network.value;
    return [
      ['Driver', n.driver],
      ['Scope', n.scope],
      ['Subnets', n.subnets.join(', ') || '-'],
      ['Internal', n.internal ? 'yes' : 'no'],
    ];
  }
  return [];
});

// Image "used by" is derived from containers (image list carries only a count).
const usedBy = computed<string[]>(() => {
  if (props.kind === 'volume') return volume.value?.usedBy ?? [];
  if (props.kind === 'network') return network.value?.usedBy ?? [];
  return (containers.data.value ?? []).filter((c) => c.imageId === props.id).map((c) => c.id);
});

const usedByRows = computed(() =>
  usedBy.value.map((id) => ({ id, name: (containers.data.value ?? []).find((c) => c.id === id)?.name ?? shortId(id) })),
);
</script>

<template>
  <div class="flex h-full flex-col overflow-auto" data-testid="docker-resource-detail" :data-kind="kind">
    <div class="shrink-0 border-b border-border px-3 py-2">
      <span class="text-kira-lg font-semibold" data-testid="docker-resource-title">{{ title }}</span>
    </div>
    <div class="flex flex-col gap-4 p-3">
      <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <template v-for="[k, v] in facts" :key="k">
          <dt class="text-muted-foreground">{{ k }}</dt>
          <dd class="font-data break-all">{{ v }}</dd>
        </template>
      </dl>
      <section>
        <h3 class="mb-1 text-kira-sm uppercase tracking-wider text-muted-foreground">Used by</h3>
        <p v-if="usedByRows.length === 0" class="text-muted-foreground" data-testid="docker-used-by-empty">No containers.</p>
        <button
          v-for="row in usedByRows"
          :key="row.id"
          type="button"
          class="block cursor-default rounded-kira-sm px-1 text-left hover:bg-hover"
          data-testid="docker-used-by"
          @click="ui.select({ kind: 'container', id: row.id })"
        >
          {{ row.name }}
        </button>
      </section>
      <section class="h-80">
        <h3 class="mb-1 text-kira-sm uppercase tracking-wider text-muted-foreground">Raw</h3>
        <InspectView v-if="inspect.data.value" :raw="inspect.data.value.raw" />
      </section>
    </div>
  </div>
</template>
