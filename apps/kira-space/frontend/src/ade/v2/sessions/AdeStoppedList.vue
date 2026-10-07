<script setup lang="ts">
import AdeStoppedRow from './AdeStoppedRow.vue';
import type { SessionView } from './sessionView';

// Finished / stopped sessions: age, Take over, label. A background run's label opens its log inline.
defineProps<{ views: SessionView[]; archived?: boolean }>();
</script>

<template>
  <div
    v-if="views.length"
    class="flex max-h-37.5 shrink-0 flex-col gap-1 overflow-auto border-t border-border bg-elevated px-3 pb-2.5 pt-2"
    data-testid="ade-stopped-list"
  >
    <div class="text-kira-sm text-muted-foreground">Finished / stopped</div>
    <AdeStoppedRow v-for="v in views" :key="v.session.id" :view="v" :archived="archived" />
  </div>
</template>
