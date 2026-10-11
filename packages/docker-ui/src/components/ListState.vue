<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@theme/components/ui/empty';

defineProps<{ icon: string; title: string; hint?: string }>();
</script>

<template>
  <Empty class="h-full" data-testid="docker-list-empty">
    <EmptyHeader>
      <EmptyMedia><CodiconIcon :name="icon" :size="24" /></EmptyMedia>
      <EmptyTitle>{{ title }}</EmptyTitle>
      <EmptyDescription v-if="hint">{{ hint }}</EmptyDescription>
    </EmptyHeader>
  </Empty>
</template>
