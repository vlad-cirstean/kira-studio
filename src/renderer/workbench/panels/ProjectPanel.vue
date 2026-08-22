<script setup lang="ts">
import ProjectTree from '../../project/ProjectTree.vue';
import SearchBox from '../../project/SearchBox.vue';
import { connectionsState, openCreateDialog } from '../../project/state/connections';
import { openFiltersDialog } from '../../project/state/tree';
import Codicon from '../../theme/Codicon.vue';
import EmptyState from './EmptyState.vue';

function onFilters(): void {
  const first = connectionsState.records[0];
  if (first) void openFiltersDialog(first.id);
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div
      class="flex h-7 flex-shrink-0 items-center justify-between border-b border-line px-2 text-[11px] font-semibold uppercase tracking-wide text-muted"
    >
      <span>Project</span>
      <div class="flex gap-0.5">
        <button
          type="button"
          class="flex h-[22px] w-[22px] items-center justify-center rounded-kira text-muted hover:bg-hover hover:text-fg"
          title="Filters"
          data-testid="project-filters"
          @click="onFilters"
        >
          <Codicon name="filter" :size="13" />
        </button>
        <button
          type="button"
          class="flex h-[22px] w-[22px] items-center justify-center rounded-kira text-muted hover:bg-hover hover:text-fg"
          title="New connection"
          data-testid="new-connection"
          @click="openCreateDialog"
        >
          <Codicon name="add" :size="13" />
        </button>
      </div>
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
