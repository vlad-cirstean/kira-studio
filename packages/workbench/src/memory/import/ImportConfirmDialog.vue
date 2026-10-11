<script setup lang="ts">
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { t } from '@theme/i18n';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { formatDuration } from '../../behaviour/format';
import { errorText } from '../../bridge/codedError';
import { useImportAction, useImportJob } from './importQueries';
import { useImportUiStore } from './importStore';

// P211: the scan result and its cost estimate, confirmed before any Claude call is made.
const emit = defineEmits<{ close: [] }>();
const ui = useImportUiStore();
const { confirmJobId } = storeToRefs(ui);
const detail = useImportJob(confirmJobId);
const act = useImportAction();
const actError = computed(() => (act.isError.value ? errorText(act.error.value) : ''));

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
    <DialogContent size="md" data-testid="import-confirm-dialog">
      <DialogHeader>
        <DialogTitle>{{ t('memory.import.documents.label') }}</DialogTitle>
      </DialogHeader>
      <DialogBody class="text-kira-md">
        <Alert v-if="actError" variant="error" data-testid="import-confirm-error">
          <AlertDescription>{{ actError }}</AlertDescription>
        </Alert>
        <p v-if="scanning" class="m-0 text-muted-foreground" data-testid="import-scanning">{{ t('memory.import.confirm.scanning.loading') }}</p>
        <Alert v-else-if="failed" variant="error">
          <AlertDescription>{{ job?.reason }}</AlertDescription>
        </Alert>
        <p v-else-if="empty" class="m-0" data-testid="import-nothing">
          {{
            job && job.totals.skippedFiles > 0
              ? t('memory.import.confirm.nothingSkipped.description', { count: job.totals.skippedFiles })
              : t('memory.import.confirm.nothing.description')
          }}
        </p>
        <template v-else-if="ready && job">
          <p class="m-0" data-testid="import-estimate">
            {{
              t('memory.import.confirm.estimate.description', {
                files: t('memory.import.confirm.files.label', { count: job.estimate.files }),
                chunks: t('memory.import.confirm.chunks.label', { count: job.estimate.chunks }),
                calls: t('memory.import.confirm.calls.label', { count: job.estimate.calls }),
                duration: formatDuration(job.estimate.seconds * 1000),
              })
            }}
          </p>
          <p class="m-0 text-muted-foreground">
            {{
              t('memory.import.confirm.cost.description', {
                skipped: t('memory.import.confirm.skipped.label', { count: job.totals.skippedFiles }),
                ignored: t('memory.import.confirm.ignored.label', { count: job.ignoredCount }),
              })
            }}
          </p>
          <p v-if="job.truncated" class="m-0 text-warn" data-testid="import-truncated">
            {{ t('memory.import.confirm.truncated.description', { count: job.estimate.files }) }}
          </p>
        </template>
      </DialogBody>
      <DialogFooter>
        <Button variant="dialog" size="kira-lg" data-testid="import-confirm-cancel" @click="dismiss">{{ t('common.action.cancel.label') }}</Button>
        <Button variant="dialog-primary" size="kira-lg" :disabled="!ready || act.isPending.value" data-testid="import-confirm-start" @click="start">
          {{ t('memory.import.start.label') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
