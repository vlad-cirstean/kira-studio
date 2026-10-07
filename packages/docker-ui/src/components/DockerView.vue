<script setup lang="ts">
import { computed } from 'vue';
import { useDockerStatus } from '../queries';
import { useDockerUiStore } from '../state/dockerUi';
import ContainerDetail from './ContainerDetail.vue';
import EngineOverview from './EngineOverview.vue';
import ResourceDetail from './ResourceDetail.vue';
import UnavailableState from './UnavailableState.vue';

const ui = useDockerUiStore();
const status = useDockerStatus();
const sel = computed(() => ui.selection);
</script>

<template>
  <div class="h-full min-h-0" data-testid="docker-view">
    <UnavailableState v-if="status.data.value?.state === 'unavailable'" :status="status.data.value" />
    <ContainerDetail v-else-if="sel?.kind === 'container'" :key="sel.id" :container-id="sel.id" />
    <ResourceDetail v-else-if="sel" :key="`${sel.kind}:${sel.id}`" :kind="sel.kind" :id="sel.id" />
    <EngineOverview v-else />
  </div>
</template>
