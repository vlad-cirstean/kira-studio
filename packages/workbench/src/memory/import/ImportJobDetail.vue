<script setup lang="ts">
import type { ImportAction } from '@shared/domain/memoryImport';
import { useVirtualizer } from '@tanstack/vue-virtual';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Progress } from '@theme/components/ui/progress';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { storeToRefs } from 'pinia';
import { computed, useTemplateRef } from 'vue';
import ImportFileRow from './ImportFileRow.vue';
import { jobTitle } from './importFormat';
import { useImportAction, useImportJob, useRetryImportFile } from './importQueries';
import { useImportUiStore } from './importStore';

// P211: one import — state, totals, job actions and its virtualized file list.
const props = defineProps<{ jobId: string }>();
const ui = useImportUiStore();
const { selectedFileId } = storeToRefs(ui);
const detail = useImportJob(() => props.jobId);
const act = useImportAction();
const retryFile = useRetryImportFile();
const { confirmDialog } = useConfirmDialogStore();

const ROW_HEIGHT = 32;
const job = computed(() => detail.data.value?.job);
const files = computed(() => detail.data.value?.files ?? []);
const selectedFile = computed(() => files.value.find((f) => f.id === selectedFileId.value));
const percent = computed(() => {
  const p = job.value?.progress;
  return p && p.chunksTotal > 0 ? (p.chunksDone / p.chunksTotal) * 100 : 0;
});

const scrollRef = useTemplateRef<HTMLDivElement>('scroll');
const virtualizer = useVirtualizer(
  computed(() => ({
    count: files.value.length,
    getScrollElement: () => scrollRef.value,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  })),
);

function run(action: ImportAction): void {
  act.mutate({ action, id: props.jobId });
}

async function discard(): Promise<void> {
  const ok = await confirmDialog('Remove this import and its progress? Memories already stored stay.', {
    confirmLabel: 'Discard',
  });
  if (ok) run('discard');
}
</script>

<template>
  <div v-if="job" class="flex h-full min-h-0 flex-col" data-testid="import-job" :data-state="job.state">
    <div class="flex shrink-0 flex-col gap-1.5 border-b border-border p-3">
      <div class="flex items-center gap-1.5">
        <span class="min-w-0 flex-1 truncate text-kira-md font-medium" :title="job.roots.join(', ')">{{ jobTitle(job) }}</span>
        <span class="text-kira-sm uppercase tracking-wider text-muted-foreground" data-testid="import-job-state">{{ job.state }}</span>
        <Button v-if="job.state === 'awaiting'" variant="toolbar" size="kira" data-testid="import-start" @click="run('start')">Start</Button>
        <Button v-if="job.state === 'running'" variant="toolbar" size="kira" data-testid="import-pause" @click="run('pause')">Pause</Button>
        <Button v-if="job.state === 'paused'" variant="toolbar" size="kira" data-testid="import-resume" @click="run('resume')">Resume</Button>
        <Button v-if="job.state === 'running' || job.state === 'paused'" variant="toolbar" size="kira" data-testid="import-cancel" @click="run('cancel')">Cancel</Button>
        <Button
          v-if="job.totals.failedFiles > 0 && job.state !== 'running'"
          size="kira"
          variant="toolbar"
          data-testid="import-retry-failed"
          @click="run('retryFailed')"
        >
          Retry failed
        </Button>
        <Button v-if="job.state === 'done' || job.state === 'cancelled' || job.state === 'failed'" variant="toolbar" size="kira" data-testid="import-dismiss" @click="run('dismiss')">Dismiss</Button>
        <Button v-if="job.state !== 'running'" variant="toolbar" size="kira" data-testid="import-discard" @click="discard">Discard</Button>
      </div>
      <Alert v-if="job.reason && (job.state === 'paused' || job.state === 'failed')" variant="destructive" data-testid="import-reason">
        <AlertDescription>{{ job.reason }}</AlertDescription>
      </Alert>
      <Alert v-if="act.isError.value" variant="destructive" data-testid="import-action-error">
        <AlertDescription>{{ act.error.value?.message }}</AlertDescription>
      </Alert>
      <Progress v-if="job.state === 'running' || job.state === 'paused'" :model-value="percent" />
      <div class="flex flex-wrap gap-x-3 text-kira-sm text-muted-foreground" data-testid="import-totals">
        <span>{{ job.progress.filesDone }} / {{ job.progress.filesTotal }} files</span>
        <span>{{ job.totals.added }} added</span>
        <span>{{ job.totals.updated }} updated</span>
        <span>{{ job.totals.noop }} known</span>
        <span v-if="job.totals.unresolved > 0">{{ job.totals.unresolved }} unresolved</span>
        <span v-if="job.totals.failedFiles > 0">{{ job.totals.failedFiles }} failed</span>
        <span v-if="job.totals.skippedFiles > 0">{{ job.totals.skippedFiles }} skipped</span>
      </div>
    </div>
    <div ref="scroll" class="min-h-0 flex-1 overflow-y-auto" data-testid="import-files">
      <div class="relative w-full" :style="{ height: `${virtualizer.getTotalSize()}px` }">
        <div
          v-for="row in virtualizer.getVirtualItems()"
          :key="files[row.index]?.id ?? row.index"
          class="absolute left-0 top-0 w-full"
          :style="{ height: `${row.size}px`, transform: `translateY(${row.start}px)` }"
        >
          <ImportFileRow
            v-if="files[row.index]"
            :file="files[row.index]!"
            :selected="selectedFileId === files[row.index]!.id"
            @select="selectedFileId = files[row.index]!.id"
            @retry="retryFile.mutate(files[row.index]!.id)"
          />
        </div>
      </div>
    </div>
    <div v-if="selectedFile" class="flex max-h-1/3 shrink-0 flex-col gap-1 overflow-y-auto border-t border-border p-3 text-kira-md" data-testid="import-file-detail">
      <span class="font-medium">{{ selectedFile.title || selectedFile.relPath }}</span>
      <p v-if="selectedFile.reason" class="m-0 text-muted-foreground" data-testid="import-file-reason">{{ selectedFile.reason }}</p>
      <div v-for="(u, i) in selectedFile.unresolved" :key="`u${i}`" class="flex flex-col rounded-kira-sm bg-warn/10 p-1.5">
        <span>{{ u.fact }}</span>
        <span v-for="q in u.questions" :key="q" class="text-kira-sm text-muted-foreground">{{ q }}</span>
      </div>
      <div v-for="(d, i) in selectedFile.dropped" :key="`d${i}`" class="flex flex-col rounded-kira-sm border border-border p-1.5">
        <span>{{ d.fact }}</span>
        <span class="text-kira-sm text-muted-foreground">Dropped: {{ d.why }}</span>
      </div>
    </div>
  </div>
</template>
