<script setup lang="ts">
import FiltersDialog from '../../project/FiltersDialog.vue';
import ProjectTree from '../../project/ProjectTree.vue';
import SchemaDialog from '../../project/SchemaDialog.vue';
import { treeState } from '../../project/state/tree';
import { connectionsState, openCreateDialog } from '../../state/connections';
import { schemaDialogState } from '../../state/schemas';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import LeftPanel from './LeftPanel.vue';
</script>

<template>
  <LeftPanel
    :search="treeState.search"
    :empty="connectionsState.records.length === 0"
    @update:search="treeState.search = $event"
  >
    <template #title>
      <span>Connections</span>
    </template>
    <template #actions>
      <IconButton
        icon="add"
        aria-label="Add connection"
        v-tooltip="'New connection'"
        data-testid="add-connection"
        @click="openCreateDialog"
      />
    </template>
    <template #body>
      <ProjectTree />
    </template>
    <!-- FirstRun.html's side-empty: says what the panel is for, nothing more — the headline
         already lives on the main start page, so it is not repeated here. -->
    <template #empty>
      <span class="dim"><CodiconIcon name="database" :size="24" /></span>
      <span class="p-xs dim side-empty-text">Everything you connect to<br />shows up here.</span>
    </template>
  </LeftPanel>
  <FiltersDialog />
  <SchemaDialog v-if="schemaDialogState.open" />
</template>

<style scoped>
.side-empty-text {
  line-height: 1.5;
}
</style>
