<script setup lang="ts">
import Codicon from '../theme/Codicon.vue';
import IconButton from '../theme/primitives/IconButton.vue';
import { treeState } from './state/tree';
</script>

<template>
  <div class="search-box-row">
    <div class="search-box p-input ui">
      <span class="icon-box"><Codicon name="search" :size="12" class="search-icon" /></span>
      <input
        v-model="treeState.search"
        type="text"
        placeholder="Search"
        data-testid="tree-search"
      />
      <IconButton
        v-if="treeState.search"
        icon="close"
        :size="12"
        class="clear-button"
        aria-label="Clear search"
        @click="treeState.search = ''"
      />
    </div>
  </div>
</template>

<style scoped>
/* Menus.html's "Columns" filter row: a bordered p-input inset with padding
   from the panel edge, above a hairline that separates it from the list. */
.search-box-row {
  flex-shrink: 0;
  padding: var(--kira-s-2) var(--kira-s-3);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.search-box {
  width: 100%;
}

.search-icon {
  color: var(--kira-fg-muted);
}

.clear-button {
  flex-shrink: 0;
}
</style>
