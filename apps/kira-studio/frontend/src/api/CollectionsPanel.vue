<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { registerCommand } from '../shortcuts/commands';
import EmptyState from '../theme/primitives/EmptyState.vue';
import IconButton from '../theme/primitives/IconButton.vue';
import PanelShell from '../theme/primitives/PanelShell.vue';
import CollectionsTree from './CollectionsTree.vue';
import ImportReportStrip from './ImportReportStrip.vue';
import {
  collectionRecord,
  collectionsState,
  createCollection,
  importCollection,
  initCollections,
  itemRecord,
} from './state/collections';
import { openImportCurlDialog } from './state/curl';
import { openDynamicValuesDialog } from './state/dynamicValues';
import { openEnvironmentsDialog, openVariablesDialog } from './state/variables';
import { openApiRequestTab } from './tabs';

// P4 C5: the placeholder is gone — this is a real tree now, mounted through the same PanelShell
// shell Studio's ProjectPanel.vue uses. `empty` is no longer hardcoded: it is "this app has no
// collections yet", which is also what gates PanelShell's own search box (F14).
//
// The `new-request` and `new-request-empty` testids are preserved exactly as P1 left them —
// existing specs click them, and P4 has no reason to move Api's front door.
const empty = computed(() => collectionsState.collections.length === 0);

// The fetch belongs to the panel rather than the tree: PanelShell renders #body only when it is
// non-empty, so a tree that loaded itself on mount would never load at all on a fresh install —
// no collections, no tree, no call, no collections.
onMounted(initCollections);

function onSearch(value: string): void {
  collectionsState.search = value;
}

function onNewCollection(): void {
  void createCollection();
}

function onImport(): void {
  void importCollection();
}

// P5 D11: the palette's Variables… entry — opens the dialog for whichever collection is
// currently selected in the tree (a collection row directly, or a folder/request's own
// collection). A no-op with nothing selected, the same "view-scoped, no-op elsewhere" shape
// view.run/api.save already have.
function onVariablesCommand(): void {
  const selected = collectionsState.selected;
  if (!selected) return;
  if (selected.startsWith('c:')) {
    const id = selected.slice(2);
    const collection = collectionRecord(id);
    if (collection) void openVariablesDialog('collection', id, `Variables — ${collection.name}`);
    return;
  }
  if (selected.startsWith('i:')) {
    const item = itemRecord(selected.slice(2));
    const collection = item ? collectionRecord(item.collectionId) : undefined;
    if (item && collection) {
      void openVariablesDialog('collection', item.collectionId, `Variables — ${collection.name}`);
    }
  }
}

function onEnvironments(): void {
  openEnvironmentsDialog();
}

// P6 D11: the palette's own "Dynamic values…" entry — not scoped to any selection, unlike
// Variables… above.
function onDynamicValues(): void {
  openDynamicValuesDialog();
}

// P7 D12: the palette's own "Import from curl…" entry — same shape as the three above, not
// tab-scoped.
function onImportCurl(): void {
  openImportCurlDialog();
}

// D15: the palette's Import collection…, Variables…, Environments…, (P6) Dynamic values… and
// (P7) Import from curl… entries. Registered by the panel rather than a view, since the panel is
// mounted for the whole of Api mode — none is tab-scoped.
let unregisterCommands: Array<() => void> = [];
onMounted(() => {
  unregisterCommands = [
    registerCommand('api.import', onImport),
    registerCommand('api.variables', onVariablesCommand),
    registerCommand('api.environments', onEnvironments),
    registerCommand('api.dynamicValues', onDynamicValues),
    registerCommand('api.importCurl', onImportCurl),
  ];
});
onUnmounted(() => {
  for (const off of unregisterCommands) off();
});
</script>

<template>
  <PanelShell :empty="empty" :search="collectionsState.search" @update:search="onSearch">
    <template #title>
      <span>Collections</span>
    </template>
    <template #actions>
      <IconButton
        icon="add"
        aria-label="New request"
        v-tooltip="'New request'"
        data-testid="new-request"
        @click="openApiRequestTab"
      />
      <IconButton
        icon="new-folder"
        aria-label="New collection"
        v-tooltip="'New collection'"
        data-testid="new-collection"
        @click="onNewCollection"
      />
      <!-- D11: no op-log row — the panel's own action carries the spinner instead, and Wails
           handles the call in its own goroutine so nothing else is blocked while it runs. -->
      <IconButton
        :icon="collectionsState.busy ? 'loading' : 'cloud-download'"
        :class="{ spin: collectionsState.busy }"
        :disabled="collectionsState.busy"
        aria-label="Import collection"
        v-tooltip="'Import collection…'"
        data-testid="import-collection"
        @click="onImport"
      />
      <!-- P5 D3/D11: the environments dialog's own entry point — environments exist
           independently of collections, so this lives in the panel's header, not the tree. -->
      <IconButton
        icon="settings-gear"
        aria-label="Environments"
        v-tooltip="'Environments…'"
        data-testid="api-environments"
        @click="onEnvironments"
      />
    </template>
    <template #body>
      <div class="panel-body">
        <ImportReportStrip />
        <CollectionsTree class="tree-body" />
      </div>
    </template>
    <template #empty>
      <ImportReportStrip />
      <EmptyState icon="folder-library" label="No collections yet">
        <span class="p-xs dim side-empty-text"
          >Create one from the <b>+</b> above, or import a Postman collection.</span
        >
      </EmptyState>
    </template>
  </PanelShell>
</template>

<style scoped>
.panel-body {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.tree-body {
  flex: 1;
  min-height: 0;
}

.side-empty-text {
  line-height: 1.5;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
