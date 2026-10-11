<script setup lang="ts">
import { cn } from '@theme/lib/utils';
import type { HTMLAttributes } from 'vue';
import { tableCellClass, tableColumnDividerClass } from '.';

const props = defineProps<{ class?: HTMLAttributes['class'] }>();
</script>

<template>
  <td data-slot="table-cell" :class="cn(tableCellClass, tableColumnDividerClass, props.class)">
    <slot />
  </td>
</template>
