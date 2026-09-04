<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { openHttpRequestTab } from '../state/tabs';
import EmptyState from '../theme/primitives/EmptyState.vue';
import IconButton from '../theme/primitives/IconButton.vue';
import LeftPanel from '../workbench/panels/LeftPanel.vue';
import CollectionsTree from './CollectionsTree.vue';
import { collectionsState, createCollection, initCollections } from './state/collections';

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
    </template>
    <template #body>
      <CollectionsTree />
    </template>
    <template #empty>
      <EmptyState icon="globe" label="No collections yet">
        <button type="button" class="p-dlgbtn primary" data-testid="new-request-empty" @click="openHttpRequestTab">
          New request
        </button>
        <button type="button" class="p-dlgbtn" data-testid="new-collection-empty" @click="onNewCollection">
          New collection
        </button>
      </EmptyState>
    </template>
  </LeftPanel>
</template>
