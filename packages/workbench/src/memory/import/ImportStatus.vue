<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { Progress } from '@theme/components/ui/progress';
import { computed } from 'vue';
import { ACTIVE_JOB_STATES, jobTitle } from './importFormat';
import { useImportJobs } from './importQueries';
import { useImportUiStore } from './importStore';

// P211: panel row for the newest unfinished import — progress and a way into the imports view.
const ui = useImportUiStore();
const jobs = useImportJobs();

// A freshly scanned job is confirmed in its dialog, not listed here.
const job = computed(() =>
  (jobs.data.value ?? []).find(
    (j) => ACTIVE_JOB_STATES.includes(j.state) && j.id !== ui.confirmJobId,
  ),
);
const percent = computed(() => {
  const p = job.value?.progress;
  return p && p.chunksTotal > 0 ? (p.chunksDone / p.chunksTotal) * 100 : 0;
});

function open(): void {
  if (!job.value) return;
  ui.selectedJobId = job.value.id;
  ui.view = 'imports';
}
</script>

<template>
  <div
    v-if="job"
    class="flex flex-col gap-1 text-kira-sm text-muted-foreground"
    data-testid="memory-import-status"
    :data-state="job.state"
  >
    <div class="flex items-center gap-1.5">
      <span class="min-w-0 flex-1 truncate">
        {{ job.state === 'paused' ? 'Import paused' : job.state === 'running' ? 'Importing' : 'Import ready' }}:
        {{ jobTitle(job) }} · {{ job.progress.filesDone }} / {{ job.progress.filesTotal }} files
      </span>
      <Button size="xs" variant="outline" data-testid="memory-import-open" @click="open">View</Button>
    </div>
    <Progress v-if="job.state === 'running'" :model-value="percent" />
  </div>
</template>
