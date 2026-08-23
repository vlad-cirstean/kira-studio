<script setup lang="ts">
import FiltersDialog from '../../project/FiltersDialog.vue';
import ProjectTree from '../../project/ProjectTree.vue';
import SearchBox from '../../project/SearchBox.vue';
import { connectionsState, openCreateDialog } from '../../state/connections';
import Codicon from '../../theme/Codicon.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="p-panel-head">
      <span>Connections</span>
      <IconButton
        icon="add"
        :size="14"
        class="p-push"
        aria-label="Add connection"
        title="New connection"
        data-testid="add-connection"
        @click="openCreateDialog"
      />
    </div>
    <template v-if="connectionsState.records.length > 0">
      <SearchBox />
      <div class="min-h-0 flex-1">
        <ProjectTree />
      </div>
    </template>
    <!-- FirstRun.html's side-empty: says what the panel is for, nothing more — the headline
         already lives on the main start page, so it is not repeated here. -->
    <div v-else class="side-empty">
      <span class="dim"><Codicon name="database" :size="24" /></span>
      <span class="p-xs dim side-empty-text">Everything you connect to<br />shows up here.</span>
    </div>
    <FiltersDialog />
  </div>
</template>

<style scoped>
.side-empty {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--kira-s-4);
  padding: var(--kira-s-6);
  text-align: center;
}

.side-empty-text {
  line-height: 1.5;
}
</style>
