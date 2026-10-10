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

const LOADING_OPACITY = ['opacity-86', 'opacity-72', 'opacity-58', 'opacity-44', 'opacity-30'];
</script>

<template>
  <div v-if="loading" class="flex flex-col gap-1.5 p-2" data-testid="docker-list-loading" aria-busy="true">
    <div v-for="n in 5" :key="n" class="h-7 animate-pulse rounded-kira-sm bg-field" :class="LOADING_OPACITY[n - 1]" />
  </div>
  <Empty v-else-if="error" class="h-full" data-testid="docker-list-error">
    <EmptyHeader>
      <EmptyMedia><CodiconIcon name="error" :size="24" class="text-error" /></EmptyMedia>
      <EmptyTitle>Could not load</EmptyTitle>
      <EmptyDescription>The engine did not answer. Retry in a moment.</EmptyDescription>
    </EmptyHeader>
    <Button size="kira" variant="toolbar" @click="$emit('retry')">Retry</Button>
  </Empty>
  <Empty v-else class="h-full" data-testid="docker-list-empty">
    <EmptyHeader>
      <EmptyMedia><CodiconIcon :name="icon" :size="24" /></EmptyMedia>
      <EmptyTitle>{{ emptyTitle }}</EmptyTitle>
      <EmptyDescription v-if="emptyHint">{{ emptyHint }}</EmptyDescription>
    </EmptyHeader>
  </Empty>
</template>
