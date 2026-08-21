<script setup lang="ts">
import Codicon from '../../theme/Codicon.vue';
import EmptyState from './EmptyState.vue';
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="border-border flex items-center justify-between border-b px-2 py-1 text-xs">
      <span>Project</span>
      <button type="button" class="text-disabled" disabled aria-label="Add connection">
        <Codicon name="add" />
      </button>
    </div>
    <div class="min-h-0 flex-1">
      <EmptyState icon="database" label="No connections" />
    </div>
  </div>
</template>
