<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@theme/components/ui/empty';
import { usePageSearchFilterStore } from './searchFilter';

defineProps<{ filterKey: string; showAllTestid: string }>();

const pageSearchFilterStore = usePageSearchFilterStore();
</script>

<template>
  <Empty>
    <EmptyHeader>
      <EmptyMedia><CodiconIcon name="search" :size="24" /></EmptyMedia>
      <EmptyTitle>No matching rows</EmptyTitle>
    </EmptyHeader>
    <Button
      variant="toolbar"
      size="kira"
      :data-testid="showAllTestid"
      @click="pageSearchFilterStore.setSearchFiltering(filterKey, false)"
    >
      Show all rows
    </Button>
  </Empty>
</template>
