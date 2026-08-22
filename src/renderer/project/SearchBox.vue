<script setup lang="ts">
import Codicon from '../theme/Codicon.vue';
import { treeState } from './state/tree';

// §8.3 search over cached nodes (transient — never persisted, never changes what is fetched).
</script>

<template>
  <div class="flex flex-shrink-0 items-center gap-1.5 border-b border-line px-2 py-1.5 text-disabled">
    <Codicon name="search" :size="13" class="shrink-0" />
    <input
      v-model="treeState.search"
      type="text"
      placeholder="Search cached nodes…"
      class="flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-disabled"
      data-testid="tree-search"
    />
    <button
      v-if="treeState.search"
      type="button"
      class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg"
      aria-label="Clear search"
      @click="treeState.search = ''"
    >
      <Codicon name="close" :size="11" />
    </button>
  </div>
</template>
