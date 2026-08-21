<script setup lang="ts">
import ProjectTree from '../../project/ProjectTree.vue';
import SearchBox from '../../project/SearchBox.vue';
import { connectionsState, openCreateDialog } from '../../project/state/connections';
import Codicon from '../../theme/Codicon.vue';
import EmptyState from './EmptyState.vue';
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="border-border flex items-center justify-between border-b px-2 py-1 text-xs">
      <span>Project</span>
      <button
        type="button"
        data-testid="new-connection"
        aria-label="Add connection"
        @click="openCreateDialog"
      >
        <Codicon name="add" />
      </button>
    </div>

    <template v-if="connectionsState.records.length">
      <SearchBox />
      <div class="min-h-0 flex-1">
        <ProjectTree />
      </div>
    </template>

    <div v-else class="flex min-h-0 flex-1 flex-col">
      <div class="min-h-0 flex-1">
        <EmptyState icon="database" label="No connections" />
      </div>
      <button
        type="button"
        class="new-link"
        data-testid="new-connection-link"
        @click="openCreateDialog"
      >
        New connection
      </button>
    </div>
  </div>
</template>

<style scoped>
.new-link {
  background: transparent;
  border: none;
  color: var(--kira-info);
  cursor: pointer;
  padding: 8px 0;
  font-size: 12px;
}

.new-link:hover {
  text-decoration: underline;
}
</style>
