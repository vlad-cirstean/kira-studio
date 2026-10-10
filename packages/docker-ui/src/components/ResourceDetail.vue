<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Badge } from '@theme/components/ui/badge';
import { computed } from 'vue';
import { useDocker } from '../context';
import { formatCreated, formatSize, shortId, stateDotClass } from '../lib/format';
import { useContainers, useImages, useInspect, useNetworks, useVolumes } from '../queries';
import { useDockerUiStore } from '../state/dockerUi';
import type { InspectKind } from '../wire';
import DetailSection from './DetailSection.vue';
import InspectView from './InspectView.vue';

const props = defineProps<{ kind: InspectKind; id: string }>();

const ICONS: Record<InspectKind, string> = { image: 'package', volume: 'database', network: 'globe' };

const ui = useDockerUiStore();
const docker = useDocker();
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

const registryUrl = computed(() => (props.kind === 'image' ? (image.value?.registryUrl ?? '') : ''));

function openRegistry(): void {
  void docker.openExternal(registryUrl.value).catch(() => undefined);
}

const facts = computed<Array<[string, string]>>(() => {
  if (props.kind === 'image' && image.value) {
    const i = image.value;
    return [
      ['Tags', i.tags.join(', ') || '<none>'],
      ['ID', i.id],
      ['Size', formatSize(i.size)],
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
  usedBy.value.map((id) => {
    const c = (containers.data.value ?? []).find((x) => x.id === id);
    return { id, name: c?.name ?? shortId(id), state: c?.state };
  }),
);
</script>

<template>
  <div class="flex h-full flex-col overflow-auto" data-testid="docker-resource-detail" :data-kind="kind">
    <div class="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <CodiconIcon :name="ICONS[kind]" :size="16" class="text-muted-foreground" />
      <span class="min-w-0 truncate text-kira-lg font-medium" data-testid="docker-resource-title">{{ title }}</span>
      <TooltipIconButton
        v-if="registryUrl"
        icon="link-external"
        label="Open in registry"
        data-testid="docker-resource-registry"
        @click="openRegistry"
      />
      <Badge>{{ kind }}</Badge>
    </div>
    <div class="@container p-3">
      <div class="grid grid-cols-1 items-start gap-3 @3xl:grid-cols-2">
        <DetailSection title="Details">
          <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            <template v-for="[k, v] in facts" :key="k">
              <dt class="text-muted-foreground">{{ k }}</dt>
              <dd class="break-all font-data">{{ v }}</dd>
            </template>
          </dl>
        </DetailSection>
        <DetailSection title="Used by" flush>
          <p v-if="usedByRows.length === 0" class="px-3 py-2 text-muted-foreground" data-testid="docker-used-by-empty">No containers.</p>
          <button
            v-for="row in usedByRows"
            :key="row.id"
            type="button"
            class="flex h-control-lg w-full cursor-default items-center gap-2 px-3 text-left hover:bg-hover"
            data-testid="docker-used-by"
            @click="ui.select({ kind: 'container', id: row.id })"
          >
            <span class="size-1.5 rounded-full" :class="row.state ? stateDotClass(row.state) : 'bg-subtle'" />
            {{ row.name }}
          </button>
        </DetailSection>
        <DetailSection title="Raw" class="@3xl:col-span-2">
          <div class="h-80">
            <InspectView v-if="inspect.data.value" :raw="inspect.data.value.raw" />
          </div>
        </DetailSection>
      </div>
    </div>
  </div>
</template>
