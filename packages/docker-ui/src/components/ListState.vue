<script setup lang="ts">
import EmptyState from '@theme/components/EmptyState.vue';

defineProps<{ icon: string; title: string; hint?: string }>();
</script>

<template>
  <EmptyState class="h-full" data-testid="docker-list-empty" :icon="icon" :title="title" :description="hint" />
</template>
