<script setup lang="ts">
import FiltersDialog from '../../project/FiltersDialog.vue';
import ProjectTree from '../../project/ProjectTree.vue';
import SearchBox from '../../project/SearchBox.vue';
import { connectionsState, openCreateDialog } from '../../state/connections';
import Codicon from '../../theme/Codicon.vue';
import EmptyState from './EmptyState.vue';
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="border-border flex items-center justify-between border-b px-2 py-1 text-xs">
      <span>Project</span>
      <button
        type="button"
        aria-label="Add connection"
        data-testid="add-connection"
        @click="openCreateDialog"
      >
        <Codicon name="add" />
      </button>
    </div>
    <template v-if="connectionsState.records.length > 0">
      <SearchBox />
      <div class="min-h-0 flex-1">
        <ProjectTree />
      </div>
    </template>
    <div v-else class="min-h-0 flex-1">
      <EmptyState icon="database" label="No connections">
        <button type="button" class="new-connection-link" @click="openCreateDialog">
          New connection
        </button>
      </EmptyState>
    </div>
    <FiltersDialog />
  </div>
</template>

<style scoped>
.new-connection-link {
  background: transparent;
  border: none;
  color: var(--kira-accent);
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}
</style>
