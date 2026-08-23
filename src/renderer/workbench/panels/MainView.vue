<script setup lang="ts">
import { activeTab } from '../../state/tabs';
import ConsoleTabView from '../../views/console/ConsoleView.vue';
import DdlTabView from '../../views/ddl/DdlView.vue';
import DocumentTabView from '../../views/documents/DocumentView.vue';
import DataTabView from '../../views/grid/DataView.vue';
import KeyValueTabView from '../../views/keyvalue/KeyValueView.vue';
import EmptyState from './EmptyState.vue';
</script>

<template>
  <DataTabView v-if="activeTab && activeTab.kind === 'data'" :key="activeTab.id" :tab="activeTab" />
  <DdlTabView v-else-if="activeTab && activeTab.kind === 'ddl'" :key="activeTab.id" :tab="activeTab" />
  <ConsoleTabView
    v-else-if="activeTab && activeTab.kind === 'console'"
    :key="activeTab.id"
    :tab="activeTab"
  />
  <DocumentTabView
    v-else-if="activeTab && activeTab.kind === 'document'"
    :key="activeTab.id"
    :tab="activeTab"
  />
  <KeyValueTabView
    v-else-if="activeTab && activeTab.kind === 'keyvalue'"
    :key="activeTab.id"
    :tab="activeTab"
  />
  <EmptyState v-else icon="table" label="No tab open" />
</template>
