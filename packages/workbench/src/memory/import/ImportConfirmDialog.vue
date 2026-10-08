<script setup lang="ts">
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { formatDuration } from './importFormat';
import { useImportAction, useImportJob } from './importQueries';
import { useImportUiStore } from './importStore';

// P211: the scan result and its cost estimate, confirmed before any Claude call is made.
const emit = defineEmits<{ close: [] }>();
const ui = useImportUiStore();
const { confirmJobId } = storeToRefs(ui);
const detail = useImportJob(confirmJobId);
const act = useImportAction();

const job = computed(() => detail.data.value?.job);
const scanning = computed(() => !job.value || job.value.state === 'scanning');
const empty = computed(() => job.value?.state === 'awaiting' && job.value.estimate.files === 0);
const ready = computed(() => job.value?.state === 'awaiting' && job.value.estimate.files > 0);
const failed = computed(() => job.value?.state === 'failed');

async function start(): Promise<void> {
  const id = confirmJobId.value;
  if (!id) return;
  try {
    await act.mutateAsync({ action: 'start', id });
  } catch {
    return;
  }
  ui.selectedJobId = id;
  ui.view = 'imports';
  emit('close');
}

async function dismiss(): Promise<void> {
  const id = confirmJobId.value;
  if (id && job.value && job.value.state !== 'running') {
    try {
      await act.mutateAsync({ action: 'discard', id });
    } catch {
      // The job stays listed in the imports view; closing still proceeds.
    }
  }
  emit('close');
}
</script>

<template>
  <Dialog :open="true" @update:open="(v) => !v && dismiss()">
    <DialogContent :show-close-button="false" data-testid="import-confirm-dialog" class="flex flex-col p-0 gap-0 w-120">
      <DialogHeader>
        <DialogTitle>Import documents</DialogTitle>
      </DialogHeader>
      <div class="flex flex-col gap-2 p-3 text-kira-md">
        <Alert v-if="act.isError.value" variant="destructive" data-testid="import-confirm-error">
          <AlertDescription>{{ act.error.value?.message }}</AlertDescription>
        </Alert>
        <p v-if="scanning" class="m-0 text-muted-foreground" data-testid="import-scanning">Scanning…</p>
        <Alert v-else-if="failed" variant="destructive">
          <AlertDescription>{{ job?.reason }}</AlertDescription>
        </Alert>
        <p v-else-if="empty" class="m-0" data-testid="import-nothing">
          No importable files found.
          <template v-if="job && job.totals.skippedFiles > 0">{{ job.totals.skippedFiles }} skipped.</template>
        </p>
        <template v-else-if="ready && job">
          <p class="m-0" data-testid="import-estimate">
            {{ job.estimate.files }} files, {{ job.estimate.chunks }} chunks,
            {{ job.estimate.calls }} Claude calls, {{ formatDuration(job.estimate.seconds) }}.
          </p>
          <p class="m-0 text-muted-foreground">
            Runs on your Claude subscription. {{ job.totals.skippedFiles }} files skipped,
            {{ job.ignoredCount }} ignored by .gitignore.
          </p>
          <p v-if="job.truncated" class="m-0 text-warn" data-testid="import-truncated">
            Too many files: only the first {{ job.estimate.files }} are included.
          </p>
        </template>
      </div>
      <DialogFooter>
        <Button variant="dialog" size="kira-lg" data-testid="import-confirm-cancel" @click="dismiss">Cancel</Button>
        <Button variant="dialog-primary" size="kira-lg" class="ml-auto" :disabled="!ready || act.isPending.value" data-testid="import-confirm-start" @click="start">
          Start import
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
