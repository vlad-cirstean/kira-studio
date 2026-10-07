<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query';
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Checkbox } from '@theme/components/ui/checkbox';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@theme/components/ui/input-group';
import { tabChipVariants } from '@theme/components/ui/tabs';
import { usePanelHeaderSearch } from '@workbench/util/panelSearch';
import { computed, ref, useTemplateRef } from 'vue';
import {
  useContainers,
  useDockerLiveSync,
  useDockerStatus,
  useImages,
  useNetworks,
  useVolumes,
} from '../queries';
import { type DockerSection, useDockerUiStore } from '../state/dockerUi';
import { useStatsSubscription } from '../state/useStatsSubscription';
import ContainerList from './ContainerList.vue';
import EndpointChip from './EndpointChip.vue';
import ImageList from './ImageList.vue';
import NetworkList from './NetworkList.vue';
import VolumeList from './VolumeList.vue';

const ui = useDockerUiStore();
const qc = useQueryClient();
const status = useDockerStatus();
const containers = useContainers();
const images = useImages();
const volumes = useVolumes();
const networks = useNetworks();

useDockerLiveSync();

const runningIds = computed(() =>
  (containers.data.value ?? []).filter((c) => c.state === 'running').map((c) => c.id),
);
useStatsSubscription(runningIds);

const ok = computed(() => status.data.value?.state === 'ok');

const sections = computed<{ id: DockerSection; label: string; count: number }[]>(() => [
  { id: 'containers', label: 'Containers', count: containers.data.value?.length ?? 0 },
  { id: 'images', label: 'Images', count: images.data.value?.length ?? 0 },
  { id: 'volumes', label: 'Volumes', count: volumes.data.value?.length ?? 0 },
  { id: 'networks', label: 'Networks', count: networks.data.value?.length ?? 0 },
]);

const rootEl = useTemplateRef<HTMLElement>('rootEl');
const { showSearch, toggleSearch } = usePanelHeaderSearch(rootEl, {
  searchable: () => ok.value,
  getSearch: () => ui.search,
  setSearch: (v) => {
    ui.search = v;
  },
});

const refreshing = ref(false);
async function refresh(): Promise<void> {
  refreshing.value = true;
  try {
    await qc.invalidateQueries({ queryKey: ['docker'] });
  } finally {
    refreshing.value = false;
  }
}
</script>

<template>
  <div ref="rootEl" class="flex h-full flex-col" data-testid="docker-panel">
    <div class="flex h-bar shrink-0 items-center gap-1 border-b border-border px-1.5 text-kira-sm uppercase tracking-wider text-muted-foreground">
      <span class="font-semibold">Docker</span>
      <EndpointChip />
      <TooltipIconButton
        icon="search"
        :label="showSearch ? 'Hide search' : 'Search'"
        class="ml-auto"
        :data-active="showSearch"
        :disabled="!ok"
        data-testid="toggle-search"
        @click="toggleSearch"
      />
      <TooltipIconButton icon="refresh" label="Refresh" data-testid="docker-refresh" :disabled="refreshing" @click="refresh" />
    </div>
    <div v-if="ok && showSearch" class="shrink-0 border-b border-border px-1.5 py-1">
      <InputGroup>
        <InputGroupAddon><CodiconIcon name="search" :size="13" /></InputGroupAddon>
        <InputGroupInput v-model="ui.search" placeholder="Search" data-testid="tree-search" />
        <InputGroupAddon v-if="ui.search" align="inline-end">
          <InputGroupButton aria-label="Clear search" @click="ui.search = ''">
            <CodiconIcon name="close" :size="12" />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
    <template v-if="ok">
      <div class="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-border px-1.5 py-1">
        <button
          v-for="s in sections"
          :key="s.id"
          type="button"
          :class="tabChipVariants({ active: ui.section === s.id })"
          :data-testid="`docker-section-${s.id}`"
          :aria-pressed="ui.section === s.id"
          @click="ui.setSection(s.id)"
        >
          {{ s.label }}
          <span class="text-kira-sm text-muted-foreground" data-testid="docker-section-count">{{ s.count }}</span>
        </button>
      </div>
      <div
        v-if="ui.section === 'containers'"
        class="flex shrink-0 cursor-default items-center gap-1.5 border-b border-border px-1.5 py-1 text-kira-sm text-muted-foreground"
      >
        <Checkbox id="docker-show-stopped" v-model="ui.showStopped" data-testid="docker-show-stopped" />
        <label for="docker-show-stopped" class="cursor-default">Show stopped</label>
      </div>
      <ContainerList v-if="ui.section === 'containers'" />
      <ImageList v-else-if="ui.section === 'images'" />
      <VolumeList v-else-if="ui.section === 'volumes'" />
      <NetworkList v-else />
    </template>
    <div
      v-else
      class="flex flex-1 items-center justify-center p-4 text-center text-kira-md text-muted-foreground"
      data-testid="docker-panel-unavailable"
    >
      {{ status.data.value ? 'Docker unavailable' : 'Connecting…' }}
    </div>
  </div>
</template>
