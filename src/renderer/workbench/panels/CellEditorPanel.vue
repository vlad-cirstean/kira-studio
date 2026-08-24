<script setup lang="ts">
import { computed } from 'vue';
import { selectedCellFor } from '../../state/cellSelection';
import { tabsState } from '../../state/tabs';
import CellEditorView from '../../views/celleditor/CellEditorView.vue';

// P26 commit 1 scaffolding: the panel is still shell-mounted at this point in the phase, so it
// has no per-tab identity of its own — it reads the *active* tab's selection, a one-commit-lived
// stand-in for the real per-view mount commit 2 adds (which deletes this file entirely).
const cell = computed(() => (tabsState.activeId ? selectedCellFor(tabsState.activeId) : null));
</script>

<template>
  <CellEditorView v-if="cell" :cell="cell" />
</template>
