<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Badge } from '@theme/components/ui/badge';
import { cn } from '@theme/lib/utils';
import type { HTMLAttributes } from 'vue';

const props = withDefaults(
  defineProps<{
    value: string;
    icon: string;
    chip: string;
    variant?: 'default' | 'info' | 'warn';
    class?: HTMLAttributes['class'];
  }>(),
  { variant: 'default' },
);
</script>

<template>
  <!-- Badge + icon + truncating value; same recipe as git graph ref badges (refBadges.ts). -->
  <Badge :variant="variant" data :class="cn('min-w-0', props.class)" :data-chip="chip">
    <CodiconIcon :name="icon" :size="12" class="shrink-0" />
    <slot><span v-if="value" class="min-w-0 truncate">{{ value }}</span></slot>
  </Badge>
</template>
