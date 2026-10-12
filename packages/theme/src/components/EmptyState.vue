<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@theme/components/ui/empty';

// The one empty / unavailable composition. Default slot = actions (Retry, a primary button).
// Side panels pass no actions (P16); a module front door uses ModuleStart instead.
defineProps<{ icon?: string; title: string; description?: string }>();
</script>

<template>
  <Empty data-slot="empty-state">
    <EmptyHeader>
      <EmptyMedia v-if="icon"><CodiconIcon :name="icon" :size="24" /></EmptyMedia>
      <EmptyTitle>{{ title }}</EmptyTitle>
      <EmptyDescription v-if="description">{{ description }}</EmptyDescription>
    </EmptyHeader>
    <EmptyContent v-if="$slots.default"><slot /></EmptyContent>
  </Empty>
</template>
