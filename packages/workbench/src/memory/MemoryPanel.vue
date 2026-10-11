<script setup lang="ts">
import { rowIndent, rowVariants } from '@theme/components/rowVariants';
import SearchField from '@theme/components/SearchField.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Badge } from '@theme/components/ui/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@theme/components/ui/empty';
import { Label } from '@theme/components/ui/label';
import { Switch } from '@theme/components/ui/switch';
import { cn } from '@theme/lib/utils';
import { refDebounced } from '@vueuse/core';
import PanelBar from '@workbench/components/PanelBar.vue';
import PanelHeader from '@workbench/components/PanelHeader.vue';
import { storeToRefs } from 'pinia';
import { computed, ref, useId, useTemplateRef, watch } from 'vue';
import { useFocusOnMount } from '../behaviour/focus';
import { useListNavigation } from '../behaviour/listNavigation';
import { usePanelHeaderSearch } from '../behaviour/panelSearch';
import { TIMING } from '../behaviour/timing';
import QueryState from '../components/QueryState.vue';
import AddMemoryDialog from './AddMemoryDialog.vue';
import ImportConfirmDialog from './import/ImportConfirmDialog.vue';
import ImportMenu from './import/ImportMenu.vue';
import ImportStatus from './import/ImportStatus.vue';
import { useImportChangeSync } from './import/importQueries';
import { useImportUiStore } from './import/importStore';
import MemorySetupHint from './MemorySetupHint.vue';
import { useMemoryChangeSync, useMemorySearch, useMemorySemanticStatus } from './queries';
import { useMemoryUiStore } from './store';

// P201: the Memory module's left panel — recall-first search over the shared memory store, the
// same service the kira-memory MCP server writes through.
const ui = useMemoryUiStore();
const { query, includeHistory, selectedId, addOpen } = storeToRefs(ui);
const debounced = refDebounced(query, TIMING.search);
const search = useMemorySearch(debounced, includeHistory);
useMemoryChangeSync();
useImportChangeSync();
const imports = useImportUiStore();

const rootEl = useTemplateRef<HTMLElement>('root');
const searchInput = computed(() => rootEl.value?.querySelector<HTMLInputElement>('[data-testid="memory-search"]') ?? null);
useFocusOnMount(searchInput);
// Recall-first: the field is always shown; a printable key on the list redirects into it.
const { showSearch } = usePanelHeaderSearch(rootEl, {
  searchable: () => true,
  getSearch: () => query.value,
  setSearch: (value) => {
    query.value = value;
  },
  searchTestid: 'memory-search',
});
showSearch.value = true;

const resultsEl = useTemplateRef<HTMLElement>('resultsEl');
const activeKey = ref<string | null>(null);
watch(
  selectedId,
  (id) => {
    activeKey.value = id;
  },
  { immediate: true },
);
const nav = useListNavigation({
  container: resultsEl,
  items: () => search.data.value ?? [],
  key: (m) => m.id,
  activeKey,
  onOpen: (m) => selectMemory(m.id),
  onSelect: (m) => selectMemory(m.id),
});
const semanticStatus = useMemorySemanticStatus();
const semanticState = computed(() => semanticStatus.data.value?.state);
const semanticNeedsSetup = computed(() => semanticState.value === 'notInstalled' || semanticState.value === 'unavailable');

function selectMemory(id: string): void {
  selectedId.value = id;
  imports.view = 'memory';
}

const historyToggleId = useId();
</script>

<template>
  <div ref="root" class="flex h-full flex-col" data-testid="memory-panel">
    <PanelHeader>
      Memory
      <template #actions>
        <TooltipIconButton
          icon="add"
          label="Add memory"
          data-testid="memory-add"
          @click="addOpen = true"
        />
        <ImportMenu />
      </template>
    </PanelHeader>
    <PanelBar>
      <SearchField v-model="query" placeholder="Search memories" data-testid="memory-search" />
      <div class="flex items-center gap-1.5 text-kira-sm text-muted-foreground">
        <Switch :id="historyToggleId" v-model="includeHistory" data-testid="memory-include-history" />
        <Label :for="historyToggleId">Include history</Label>
      </div>
      <MemorySetupHint
        v-if="semanticNeedsSetup"
        :message="semanticState === 'notInstalled' ? 'Semantic search is off.' : 'Semantic search unavailable.'"
        data-testid="memory-setup-hint-semantic"
      />
      <ImportStatus />
    </PanelBar>
    <div ref="resultsEl" class="min-h-0 flex-1 overflow-y-auto" data-testid="memory-results">
      <QueryState :query="search" loading-label="Loading memories…">
        <template #error="{ message }">
          <Alert variant="error" strip data-testid="memory-error">
            <AlertDescription>{{ message }}</AlertDescription>
          </Alert>
        </template>
        <template #empty>
          <Empty class="h-full" data-testid="memory-empty">
            <EmptyHeader>
              <EmptyTitle>{{ query.trim() === '' ? 'No memories yet' : 'No matching memories' }}</EmptyTitle>
              <EmptyDescription v-if="query.trim() !== ''">Add one, or let Claude Code store them.</EmptyDescription>
            </EmptyHeader>
            <MemorySetupHint
              v-if="query.trim() === ''"
              message="Connect Claude Code in Settings to let it store memories."
              data-testid="memory-setup-hint-claude"
            />
          </Empty>
        </template>
        <template #default="{ data }">
        <div class="flex flex-col">
        <button
          v-for="memory in data"
          :key="memory.id"
          type="button"
          v-bind="nav.rowProps(memory.id)"
          :class="
            cn(
              rowVariants({ layout: 'double', selected: selectedId === memory.id }),
              'w-full flex-col gap-1 whitespace-normal border-b border-border py-1.5 text-left',
              memory.historical && 'opacity-70',
            )
          "
          :style="rowIndent(0)"
          :data-testid="`memory-row-${memory.id}`"
          @click="selectMemory(memory.id)"
        >
          <span class="line-clamp-2 text-kira-md">{{ memory.fact }}</span>
          <span class="flex items-center gap-1">
            <Badge :variant="memory.author === 'user' ? 'info' : 'default'">{{ memory.author }}</Badge>
            <Badge v-if="memory.historical" variant="warn">historical</Badge>
            <Badge v-if="memory.match === 'semantic'" variant="info" data-testid="memory-match-semantic">semantic</Badge>
            <span v-if="memory.versions > 1" class="text-kira-sm text-muted-foreground">v{{ memory.version }}</span>
          </span>
        </button>
        </div>
        </template>
      </QueryState>
    </div>
    <AddMemoryDialog v-if="addOpen" @close="addOpen = false" />
    <ImportConfirmDialog v-if="imports.confirmJobId" @close="imports.confirmJobId = null" />
  </div>
</template>
