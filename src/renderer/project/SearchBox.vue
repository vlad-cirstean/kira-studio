<script setup lang="ts">
import Codicon from '../theme/Codicon.vue';
import { treeState } from './state/tree';

// §8.3 search over cached nodes (transient — never persisted, never changes what is fetched).
</script>

<template>
  <div class="search-box">
    <Codicon name="search" :size="14" class="icon" />
    <input
      v-model="treeState.search"
      type="text"
      placeholder="Search cached nodes"
      data-testid="tree-search"
    />
    <button
      v-if="treeState.search"
      type="button"
      class="clear"
      aria-label="Clear search"
      @click="treeState.search = ''"
    >
      <Codicon name="close" :size="12" />
    </button>
  </div>
</template>

<style scoped>
.search-box {
  position: relative;
  display: flex;
  align-items: center;
  margin: 4px 6px;
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius);
  background: var(--kira-bg-input);
}

.icon {
  position: absolute;
  left: 6px;
  color: var(--kira-fg-muted);
  pointer-events: none;
}

.search-box input {
  width: 100%;
  padding: 3px 22px 3px 24px;
  background: transparent;
  border: none;
  color: var(--kira-fg);
  font-size: 12px;
}

.search-box input:focus {
  outline: none;
}

.clear {
  position: absolute;
  right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--kira-fg-muted);
  cursor: pointer;
}

.clear:hover {
  color: var(--kira-fg);
}
</style>
