<script setup lang="ts">
import { cn } from '@theme/lib/utils';
import type { HTMLAttributes } from 'vue';
import { tableColumnDividerClass, tableHeadClass } from '.';

const props = defineProps<{ class?: HTMLAttributes['class'] }>();
</script>

<template>
  <th data-slot="table-head" :class="cn(tableHeadClass, tableColumnDividerClass, props.class)">
    <slot />
  </th>
</template>
