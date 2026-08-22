<script setup lang="ts">
import { activeTab } from '../../state/tabs';
import DataTabView from '../../views/grid/DataView.vue';
import EmptyState from './EmptyState.vue';
</script>

<template>
  <DataTabView v-if="activeTab && activeTab.kind === 'data'" :tab="activeTab" />
  <EmptyState v-else icon="table" label="No tab open" />
</template>
