<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Badge } from '@theme/components/ui/badge';
import { cn } from '@theme/lib/utils';
import type { HTMLAttributes } from 'vue';

const props = withDefaults(
  defineProps<{
    name: string;
    variant?: 'default' | 'info' | 'warn';
    class?: HTMLAttributes['class'];
  }>(),
  { variant: 'default' },
);
</script>

<template>
  <!-- Branch name as a value; same recipe as git graph ref badges (refBadges.ts). -->
  <Badge :variant="variant" data :class="cn('min-w-0', props.class)" data-testid="branch-chip">
    <CodiconIcon name="git-branch" :size="12" class="shrink-0" />
    <span v-if="name" class="min-w-0 truncate">{{ name }}</span>
  </Badge>
</template>
