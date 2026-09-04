<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { registerCommand } from '../shortcuts/commands';
import { openHttpRequestTab } from '../state/tabs';
import EmptyState from '../theme/primitives/EmptyState.vue';
import IconButton from '../theme/primitives/IconButton.vue';
import LeftPanel from '../workbench/panels/LeftPanel.vue';
import CollectionsTree from './CollectionsTree.vue';
import ImportReportStrip from './ImportReportStrip.vue';
import {
  collectionsState,
  createCollection,
  importCollection,
  initCollections,
} from './state/collections';

// P4 C5: the placeholder is gone — this is a real tree now, mounted through the same LeftPanel
// shell Studio's ProjectPanel.vue uses. `empty` is no longer hardcoded: it is "this app has no
// collections yet", which is also what gates LeftPanel's own search box (F14).
//
// The `new-request` and `new-request-empty` testids are preserved exactly as P1 left them —
// existing specs click them, and P4 has no reason to move Http's front door.
const empty = computed(() => collectionsState.collections.length === 0);

// The fetch belongs to the panel rather than the tree: LeftPanel renders #body only when it is
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

// D15: the palette's Import collection… entry. Registered by the panel rather than a view, since
// the panel is mounted for the whole of Http mode — an import is not tab-scoped.
let unregisterImport: (() => void) | null = null;
onMounted(() => {
  unregisterImport = registerCommand('http.import', onImport);
});
onUnmounted(() => unregisterImport?.());
</script>

<template>
  <LeftPanel :empty="empty" :search="collectionsState.search" @update:search="onSearch">
    <template #title>
      <span>Collections</span>
    </template>
    <template #actions>
      <IconButton
        icon="add"
        aria-label="New request"
        v-tooltip="'New request'"
        data-testid="new-request"
        @click="openHttpRequestTab"
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
    </template>
    <template #body>
      <div class="panel-body">
        <ImportReportStrip />
        <CollectionsTree class="tree-body" />
      </div>
    </template>
    <template #empty>
      <ImportReportStrip />
      <EmptyState icon="globe" label="No collections yet">
        <button type="button" class="p-dlgbtn primary" data-testid="new-request-empty" @click="openHttpRequestTab">
          New request
        </button>
        <button type="button" class="p-dlgbtn" data-testid="new-collection-empty" @click="onNewCollection">
          New collection
        </button>
        <button type="button" class="p-dlgbtn" data-testid="import-collection-empty" @click="onImport">
          Import collection…
        </button>
      </EmptyState>
    </template>
  </LeftPanel>
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
