<script setup lang="ts">
import { activeTab } from '../../state/tabs';
import DdlTabView from '../../views/ddl/DdlView.vue';
import DataTabView from '../../views/grid/DataView.vue';
import EmptyState from './EmptyState.vue';
</script>

<template>
  <DataTabView v-if="activeTab && activeTab.kind === 'data'" :key="activeTab.id" :tab="activeTab" />
  <DdlTabView v-else-if="activeTab && activeTab.kind === 'ddl'" :key="activeTab.id" :tab="activeTab" />
  <EmptyState v-else icon="table" label="No tab open" />
</template>
