<script setup lang="ts">
import Codicon from '../theme/Codicon.vue';
import { treeState } from './state/tree';
</script>

<template>
  <div class="search-box">
    <Codicon name="search" :size="12" class="search-icon" />
    <input
      v-model="treeState.search"
      type="text"
      placeholder="Search"
      data-testid="tree-search"
    />
    <button
      v-if="treeState.search"
      type="button"
      class="clear-button"
      aria-label="Clear search"
      @click="treeState.search = ''"
    >
      <Codicon name="close" :size="12" />
    </button>
  </div>
</template>

<style scoped>
.search-box {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.search-icon {
  color: var(--kira-fg-muted);
  flex-shrink: 0;
}

.search-box input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  color: var(--kira-fg);
  font-size: 12px;
  outline: none;
}

.clear-button {
  flex-shrink: 0;
  background: transparent;
  border: none;
  color: var(--kira-fg-muted);
  cursor: pointer;
  padding: 0;
}
</style>
