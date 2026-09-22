<script setup lang="ts">
import FiltersDialog from '../../project/FiltersDialog.vue';
import ProjectTree from '../../project/ProjectTree.vue';
import SchemaDialog from '../../project/SchemaDialog.vue';
import { useTreeStore } from '../../project/state/tree';
import { useConnectionDialogStore, useConnectionsStore } from '../../state/connections';
import { useSchemaDialogStore } from '../../state/schemas';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import PanelShell from '../../theme/primitives/PanelShell.vue';

const connectionsStore = useConnectionsStore();
const connectionDialogStore = useConnectionDialogStore();
const schemaDialogStore = useSchemaDialogStore();
const treeStore = useTreeStore();
</script>

<template>
  <PanelShell
    :search="treeStore.search"
    :empty="connectionsStore.records.length === 0"
    @update:search="treeStore.search = $event"
  >
    <template #title>
      <span>Connections</span>
    </template>
    <template #actions>
      <!-- P28 D18: the DataGrip import moved to the menu bar (App → Import DataGrip
           Connections…). It is a once-per-machine action and did not earn a permanent slot in a
           four-button header. StudioStart.vue's own first-run button stays: an empty state is
           exactly when a menu-bar-only affordance is hardest to find. -->
      <IconButton
        icon="add"
        aria-label="Add connection"
        v-tooltip="'New connection'"
        data-testid="add-connection"
        @click="connectionDialogStore.openCreateDialog"
      />
    </template>
    <template #body>
      <ProjectTree />
    </template>
    <!-- FirstRun.html's side-empty: says what the panel is for, nothing more — the headline
         already lives on the main start page, so it is not repeated here. -->
    <template #empty>
      <span class="dim"><CodiconIcon name="database" :size="24" /></span>
      <span class="p-xs dim leading-normal">Everything you connect to<br />shows up here.</span>
    </template>
  </PanelShell>
  <FiltersDialog />
  <SchemaDialog v-if="schemaDialogStore.open" />
</template>
