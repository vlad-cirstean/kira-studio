<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
// P104 §3: PanelShell is one of the 20 forbidden shared primitives (packages/theme/src/primitives/)
// -- not converted in this pass. Its own type-ahead-redirect/search-reveal logic (real app
// behavior, not styling) would need extracting into a shared composable before it could be
// inlined at its 3 call sites without duplicating that logic 3x; deferred, named explicitly
// rather than half-inlined. PanelShell.vue itself is untouched, so its own internal IconButton
// (the search toggle) and v-tooltip stay as they are for now too.
import PanelShell from '@theme/primitives/PanelShell.vue';
import FiltersDialog from '../../project/FiltersDialog.vue';
import ProjectTree from '../../project/ProjectTree.vue';
import SchemaDialog from '../../project/SchemaDialog.vue';
import { useTreeStore } from '../../project/state/tree';
import { useConnectionDialogStore, useConnectionsStore } from '../../state/connections';
import { useSchemaDialogStore } from '../../state/schemas';

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
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="toolbar"
            size="kira-icon"
            aria-label="New connection"
            data-testid="add-connection"
            @click="connectionDialogStore.openCreateDialog"
          >
            <CodiconIcon name="add" :size="13" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>New connection</TooltipContent>
      </Tooltip>
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
