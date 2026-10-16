<script setup lang="ts">
import { cn } from '@theme/lib/utils';
import type { HTMLAttributes } from 'vue';
import { tableRowClass } from '.';

const props = defineProps<{ class?: HTMLAttributes['class'] }>();
</script>

<template>
  <tr data-slot="table-row" :class="cn(tableRowClass, props.class)">
    <slot />
  </tr>
</template>
