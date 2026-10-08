<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { Empty, EmptyDescription, EmptyTitle } from '@theme/components/ui/empty';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import ImportJobDetail from './ImportJobDetail.vue';
import { jobTitle } from './importFormat';
import { useImportJobs } from './importQueries';
import { useImportUiStore } from './importStore';

// P211: the main area's imports view — job list on top, the selected job below.
const ui = useImportUiStore();
const { selectedJobId, confirmJobId } = storeToRefs(ui);
const jobs = useImportJobs();

const listed = computed(() => (jobs.data.value ?? []).filter((j) => j.id !== confirmJobId.value));
const current = computed(() => listed.value.find((j) => j.id === selectedJobId.value) ?? listed.value[0]);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" data-testid="import-view">
    <div class="flex shrink-0 items-center gap-1.5 border-b border-border p-1.5">
      <Button size="xs" variant="outline" data-testid="import-back" @click="ui.view = 'memory'">Back to memories</Button>
      <Button
        v-for="job in listed"
        :key="job.id"
        size="xs"
        :variant="job.id === current?.id ? 'secondary' : 'outline'"
        :data-testid="`import-job-${job.id}`"
        @click="selectedJobId = job.id"
      >
        {{ jobTitle(job) }}
      </Button>
    </div>
    <Empty v-if="!current" class="p-6" data-testid="import-empty">
      <EmptyTitle class="text-kira-md font-normal text-muted-foreground">No imports</EmptyTitle>
      <EmptyDescription>Import files or a folder from the panel header.</EmptyDescription>
    </Empty>
    <ImportJobDetail v-else :key="current.id" :job-id="current.id" class="min-h-0 flex-1" />
  </div>
</template>
