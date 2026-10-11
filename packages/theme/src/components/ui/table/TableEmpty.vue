<script setup lang="ts">
import { cn } from '@theme/lib/utils';
import type { HTMLAttributes } from 'vue';

const props = withDefaults(defineProps<{ class?: HTMLAttributes['class']; colspan?: number }>(), { colspan: 1 });
</script>

<template>
  <tr data-slot="table-empty">
    <td :colspan="colspan" :class="cn('h-row px-2 align-middle text-kira-sm text-subtle', props.class)">
      <slot />
    </td>
  </tr>
</template>
