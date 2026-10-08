<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Badge } from '@theme/components/ui/badge';
import { Empty, EmptyDescription, EmptyTitle } from '@theme/components/ui/empty';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@theme/components/ui/input-group';
import { Label } from '@theme/components/ui/label';
import { Switch } from '@theme/components/ui/switch';
import { refDebounced } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { computed, onMounted, useId, useTemplateRef } from 'vue';
import AddMemoryDialog from './AddMemoryDialog.vue';
import DictationStatusLine from './dictation/DictationStatusLine.vue';
import MicButton from './dictation/MicButton.vue';
import { useDictationStore } from './dictation/store';
import ImportConfirmDialog from './import/ImportConfirmDialog.vue';
import ImportMenu from './import/ImportMenu.vue';
import ImportStatus from './import/ImportStatus.vue';
import { useImportChangeSync } from './import/importQueries';
import { useImportUiStore } from './import/importStore';
import MemorySetupHint from './MemorySetupHint.vue';
import { useDictationStatus, useMemoryChangeSync, useMemorySearch, useMemorySemanticStatus } from './queries';
import { useMemoryUiStore } from './store';

// P201: the Memory module's left panel — recall-first search over the shared memory store, the
// same service the kira-memory MCP server writes through.
const ui = useMemoryUiStore();
const { query, includeHistory, selectedId, addOpen } = storeToRefs(ui);
const debounced = refDebounced(query, 200);
const search = useMemorySearch(debounced, includeHistory);
useMemoryChangeSync();
useImportChangeSync();
const imports = useImportUiStore();

const searchInput = useTemplateRef<{ $el: HTMLInputElement }>('searchInput');
const SEARCH_DICTATION_ID = 'memory-search';
const dictationStatus = useDictationStatus();
const semanticStatus = useMemorySemanticStatus();
const semanticState = computed(() => semanticStatus.data.value?.state);
const semanticNeedsSetup = computed(() => semanticState.value === 'notInstalled' || semanticState.value === 'unavailable');
const dictation = useDictationStore();
const dictating = computed(() => dictation.active && dictation.target === SEARCH_DICTATION_ID);
const showSearchAddon = computed(
  () => query.value !== '' || (dictationStatus.data.value?.state ?? 'off') !== 'off',
);
onMounted(() => {
  searchInput.value?.$el.focus();
});

function selectMemory(id: string): void {
  selectedId.value = id;
  imports.view = 'memory';
}

const historyToggleId = useId();
</script>

<template>
  <div class="flex h-full flex-col" data-testid="memory-panel">
    <div class="flex items-center shrink-0 h-bar gap-1 px-1.5 border-b border-border text-kira-sm text-muted-foreground uppercase tracking-wider">
      <span class="font-semibold">Memory</span>
      <TooltipIconButton
        icon="add"
        label="Add memory"
        class="ml-auto"
        data-testid="memory-add"
        @click="addOpen = true"
      />
      <ImportMenu />
    </div>
    <div class="flex shrink-0 flex-col gap-1 border-b border-border px-1.5 py-1">
      <InputGroup>
        <InputGroupAddon>
          <CodiconIcon name="search" :size="13" />
        </InputGroupAddon>
        <InputGroupInput ref="searchInput" v-model="query" :readonly="dictating" placeholder="Search memories" data-testid="memory-search" />
        <InputGroupAddon v-if="showSearchAddon" align="inline-end">
          <MicButton v-model="query" :target-id="SEARCH_DICTATION_ID" :input="() => searchInput?.$el ?? null" />
          <InputGroupButton v-if="query" aria-label="Clear search" @click="query = ''">
            <CodiconIcon name="close" :size="12" />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <DictationStatusLine :target-id="SEARCH_DICTATION_ID" />
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
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto" data-testid="memory-results">
      <Alert v-if="search.isError.value" variant="destructive" class="m-1.5 w-auto" data-testid="memory-error">
        <AlertDescription>{{ search.error.value?.message }}</AlertDescription>
      </Alert>
      <Empty v-else-if="search.isPending.value" class="p-6">
        <EmptyDescription>Loading…</EmptyDescription>
      </Empty>
      <Empty v-else-if="(search.data.value ?? []).length === 0" class="p-6" data-testid="memory-empty">
        <EmptyTitle class="text-kira-md font-normal text-muted-foreground">
          {{ query.trim() === '' ? 'No memories yet' : 'No matching memories' }}
        </EmptyTitle>
        <EmptyDescription v-if="query.trim() !== ''">Add one, or let Claude Code store them.</EmptyDescription>
        <MemorySetupHint
          v-else
          message="Connect Claude Code in Settings to let it store memories."
          data-testid="memory-setup-hint-claude"
        />
      </Empty>
      <div v-else class="flex flex-col">
        <button
          v-for="memory in search.data.value"
          :key="memory.id"
          type="button"
          class="flex flex-col gap-1 border-b border-border px-1.5 py-1.5 text-left cursor-default hover:bg-hover"
          :class="{ 'bg-hover': selectedId === memory.id, 'opacity-70': memory.historical }"
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
    </div>
    <AddMemoryDialog v-if="addOpen" @close="addOpen = false" />
    <ImportConfirmDialog v-if="imports.confirmJobId" @close="imports.confirmJobId = null" />
  </div>
</template>
