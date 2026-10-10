<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query';
import CodiconIcon from '@theme/CodiconIcon.vue';
import SearchField from '@theme/components/SearchField.vue';
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@theme/components/ui/empty';
import { Label } from '@theme/components/ui/label';
import PanelBar from '@workbench/components/PanelBar.vue';
import PanelHeader from '@workbench/components/PanelHeader.vue';
import { usePanelHeaderSearch } from '@workbench/util/panelSearch';
import { computed, ref, useTemplateRef } from 'vue';
import {
  useContainers,
  useDockerLiveSync,
  useDockerStatus,
  useImages,
  useNetworks,
  useRetryStatus,
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

const { retrying, retry } = useRetryStatus();

const ok = computed(() => status.data.value?.state === 'ok');

const sections = computed<{ id: DockerSection; label: string; count: number }[]>(() => [
  { id: 'containers', label: 'Containers', count: containers.data.value?.length ?? 0 },
  { id: 'images', label: 'Images', count: images.data.value?.length ?? 0 },
  { id: 'volumes', label: 'Volumes', count: volumes.data.value?.length ?? 0 },
  { id: 'networks', label: 'Networks', count: networks.data.value?.length ?? 0 },
]);

const sectionItems = computed(() =>
  sections.value.map((x) => ({ value: x.id, label: x.label, count: x.count, testid: `docker-section-${x.id}` })),
);

const running = computed(() => (containers.data.value ?? []).filter((c) => c.state === 'running').length);
const stopped = computed(() => (containers.data.value?.length ?? 0) - running.value);

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
    <PanelHeader>
      Docker
      <EndpointChip />
      <template #actions>
        <TooltipIconButton
          icon="search"
          :label="showSearch ? 'Hide search' : 'Search'"
          :pressed="showSearch"
          :disabled="!ok"
          data-testid="toggle-search"
          @click="toggleSearch"
        />
        <TooltipIconButton
          icon="dashboard"
          label="Engine overview"
          :disabled="!ok || !ui.selection"
          data-testid="docker-overview-home"
          @click="ui.select(null)"
        />
        <TooltipIconButton icon="refresh" label="Refresh" data-testid="docker-refresh" :disabled="refreshing" @click="refresh" />
      </template>
    </PanelHeader>
    <PanelBar v-if="ok && showSearch">
      <SearchField v-model="ui.search" data-testid="tree-search" />
    </PanelBar>
    <template v-if="ok">
      <PanelBar>
        <SecondaryTabs
          :model-value="ui.section"
          :items="sectionItems"
          aria-label="Docker resources"
          @update:model-value="(v) => ui.setSection(v as DockerSection)"
        >
          <template #item="{ item }">
            {{ item.label }}
            <span class="text-kira-sm text-muted-foreground" data-testid="docker-section-count">{{ item.count }}</span>
          </template>
        </SecondaryTabs>
      </PanelBar>
      <div
        v-if="ui.section === 'containers'"
        class="flex h-control shrink-0 cursor-default items-center gap-1.5 border-b border-border px-1.5 text-kira-sm text-muted-foreground"
      >
        <Checkbox id="docker-show-stopped" v-model="ui.showStopped" data-testid="docker-show-stopped" />
        <Label for="docker-show-stopped" class="cursor-default font-normal">Show stopped</Label>
        <span class="ml-auto" data-testid="docker-summary">{{ running }} running<template v-if="stopped"> · {{ stopped }} stopped</template></span>
      </div>
      <ContainerList v-if="ui.section === 'containers'" />
      <ImageList v-else-if="ui.section === 'images'" />
      <VolumeList v-else-if="ui.section === 'volumes'" />
      <NetworkList v-else />
    </template>
    <Empty v-else class="h-full" data-testid="docker-panel-unavailable">
      <EmptyHeader>
        <EmptyMedia>
          <CodiconIcon :name="status.data.value ? 'debug-disconnect' : 'loading'" :size="24" :class="status.data.value ? 'text-error' : 'codicon-modifier-spin'" />
        </EmptyMedia>
        <EmptyTitle>{{ status.data.value ? 'Docker unavailable' : 'Connecting…' }}</EmptyTitle>
        <EmptyDescription v-if="status.data.value">Details are in the main pane.</EmptyDescription>
      </EmptyHeader>
      <Button v-if="status.data.value" size="kira" variant="toolbar" :disabled="retrying" @click="retry">Retry</Button>
    </Empty>
  </div>
</template>
