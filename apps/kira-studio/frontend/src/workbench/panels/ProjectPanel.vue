<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import SearchField from '@theme/components/SearchField.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@theme/components/ui/empty';
import PanelBar from '@workbench/components/PanelBar.vue';
import PanelHeader from '@workbench/components/PanelHeader.vue';
import { usePanelHeaderSearch } from '@workbench/util/panelSearch';
import { computed, useTemplateRef } from 'vue';
import CredentialsUpdateDialog from '../../project/CredentialsUpdateDialog.vue';
import FiltersDialog from '../../project/FiltersDialog.vue';
import ProjectTree from '../../project/ProjectTree.vue';
import SchemaDialog from '../../project/SchemaDialog.vue';
import { useCredentialsDialogStore } from '../../project/state/credentialsDialog';
import { useTreeStore } from '../../project/state/tree';
import { useConnectionDialogStore, useConnectionsStore } from '../../state/connections';
import { useSchemaDialogStore } from '../../state/schemas';

const connectionsStore = useConnectionsStore();
const connectionDialogStore = useConnectionDialogStore();
const schemaDialogStore = useSchemaDialogStore();
const credentialsDialogStore = useCredentialsDialogStore();
const treeStore = useTreeStore();

const empty = computed(() => connectionsStore.records.length === 0);
// P104 §3: PanelShell's own header/search-reveal/type-ahead-redirect logic, inlined via the
// shared usePanelHeaderSearch composable rather than kept as a wrapper component.
const rootEl = useTemplateRef<HTMLElement>('rootEl');
const { showSearch, toggleSearch } = usePanelHeaderSearch(rootEl, {
  searchable: () => true,
  getSearch: () => treeStore.search,
  setSearch: (v) => {
    treeStore.search = v;
  },
});
</script>

<template>
  <div ref="rootEl" class="flex h-full min-h-0 flex-col">
    <PanelHeader>
      Connections
      <template #actions>
        <TooltipIconButton
          icon="search"
          :label="showSearch ? 'Hide search' : 'Search'"
          :pressed="showSearch"
          data-testid="toggle-search"
          @click="toggleSearch"
        />
        <!-- P28 D18: the DataGrip import moved to the menu bar (App → Import DataGrip
             Connections…). It is a once-per-machine action and did not earn a permanent slot in a
             four-button header. StudioStart.vue's own first-run button stays: an empty state is
             exactly when a menu-bar-only affordance is hardest to find. -->
        <TooltipIconButton
          icon="add"
          label="New connection"
          data-testid="add-connection"
          @click="connectionDialogStore.openCreateDialog"
        />
      </template>
    </PanelHeader>
    <template v-if="!empty">
      <PanelBar v-if="showSearch">
        <SearchField v-model="treeStore.search" data-testid="tree-search" />
      </PanelBar>
      <div class="min-h-0 flex-1">
        <ProjectTree />
      </div>
    </template>
    <!-- FirstRun.html's empty pane: says what the panel is for, nothing more — the headline
         already lives on the main start page, so it is not repeated here. -->
    <Empty v-else class="h-full">
      <EmptyHeader>
        <EmptyMedia><CodiconIcon name="database" :size="24" /></EmptyMedia>
        <EmptyDescription>Everything you connect to<br />shows up here.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  </div>
  <FiltersDialog />
  <CredentialsUpdateDialog v-if="credentialsDialogStore.open" />
  <SchemaDialog v-if="schemaDialogStore.open" />
</template>
