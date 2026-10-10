<script setup lang="ts">
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import { Button } from '@theme/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@theme/components/ui/empty';
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
const jobItems = computed(() =>
  listed.value.map((job) => ({ value: job.id, label: jobTitle(job), testid: `import-job-${job.id}` })),
);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" data-testid="import-view">
    <div class="flex shrink-0 items-center gap-1.5 border-b border-border p-1.5">
      <Button variant="toolbar" size="kira" data-testid="import-back" @click="ui.view = 'memory'">Back to memories</Button>
      <SecondaryTabs
        class="min-w-0 overflow-x-auto"
        :model-value="current?.id ?? ''"
        :items="jobItems"
        @update:model-value="(v) => (selectedJobId = v)"
      />
    </div>
    <Empty v-if="!current" class="h-full" data-testid="import-empty">
      <EmptyHeader>
        <EmptyTitle>No imports</EmptyTitle>
        <EmptyDescription>Import files or a folder from the panel header.</EmptyDescription>
      </EmptyHeader>
    </Empty>
    <ImportJobDetail v-else :key="current.id" :job-id="current.id" class="min-h-0 flex-1" />
  </div>
</template>
