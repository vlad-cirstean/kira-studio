<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@theme/components/ui/input-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { usePanelHeaderSearch } from '@workbench/util/panelSearch';
import { computed, useTemplateRef } from 'vue';
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
  <div ref="rootEl" class="flex h-full flex-col">
    <div class="flex items-center shrink-0 h-bar gap-1 px-1.5 border-b border-border text-kira-sm text-muted-foreground uppercase tracking-wider">
      <span>Connections</span>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="toolbar"
            size="kira-icon"
            class="p-push"
            :data-active="showSearch"
            :aria-label="showSearch ? 'Hide search' : 'Search'"
            data-testid="toggle-search"
            @click="toggleSearch"
          >
            <CodiconIcon name="search" :size="13" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ showSearch ? 'Hide search' : 'Search' }}</TooltipContent>
      </Tooltip>
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
    </div>
    <template v-if="!empty">
      <div v-if="showSearch" class="shrink-0 border-b border-border px-1.5 py-1">
        <InputGroup>
          <InputGroupAddon>
            <CodiconIcon name="search" :size="13" />
          </InputGroupAddon>
          <InputGroupInput v-model="treeStore.search" placeholder="Search" data-testid="tree-search" />
          <InputGroupAddon v-if="treeStore.search" align="inline-end">
            <InputGroupButton aria-label="Clear search" @click="treeStore.search = ''">
              <CodiconIcon name="close" :size="12" />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>
      <div class="min-h-0 flex-1">
        <ProjectTree />
      </div>
    </template>
    <!-- FirstRun.html's side-empty: says what the panel is for, nothing more — the headline
         already lives on the main start page, so it is not repeated here. -->
    <div
      v-else
      class="side-empty flex flex-1 min-h-0 flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <span class="text-subtle"><CodiconIcon name="database" :size="24" /></span>
      <span class="text-kira-xs text-subtle leading-normal">Everything you connect to<br />shows up here.</span>
    </div>
  </div>
  <FiltersDialog />
  <SchemaDialog v-if="schemaDialogStore.open" />
</template>
