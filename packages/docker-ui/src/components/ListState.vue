<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@theme/components/ui/empty';

defineProps<{
  loading: boolean;
  error: boolean;
  icon: string;
  emptyTitle: string;
  emptyHint?: string;
}>();

defineEmits<{ retry: [] }>();
</script>

<template>
  <div v-if="loading" class="flex flex-col gap-1.5 p-2" data-testid="docker-list-loading" aria-busy="true">
    <div v-for="n in 5" :key="n" class="h-7 animate-pulse rounded-kira-sm bg-field" :style="{ opacity: 1 - n * 0.14 }" />
  </div>
  <Empty v-else-if="error" class="p-4" data-testid="docker-list-error">
    <EmptyHeader>
      <EmptyMedia variant="icon"><CodiconIcon name="error" :size="16" class="text-error" /></EmptyMedia>
      <EmptyTitle>Could not load</EmptyTitle>
      <EmptyDescription>The engine did not answer. Retry in a moment.</EmptyDescription>
    </EmptyHeader>
    <Button size="kira" variant="secondary" @click="$emit('retry')">Retry</Button>
  </Empty>
  <Empty v-else class="p-4" data-testid="docker-list-empty">
    <EmptyHeader>
      <EmptyMedia variant="icon"><CodiconIcon :name="icon" :size="16" /></EmptyMedia>
      <EmptyTitle>{{ emptyTitle }}</EmptyTitle>
      <EmptyDescription v-if="emptyHint">{{ emptyHint }}</EmptyDescription>
    </EmptyHeader>
  </Empty>
</template>
