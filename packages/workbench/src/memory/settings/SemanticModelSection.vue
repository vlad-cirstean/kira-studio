<script setup lang="ts">
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { FieldDescription, FieldLegend, FieldSet } from '@theme/components/ui/field';
import { Progress } from '@theme/components/ui/progress';
import { t } from '@theme/i18n';
import { computed } from 'vue';
import { formatBytes } from '../../behaviour/format';
import { errorText } from '../../bridge/codedError';
import { useInstallSemanticModel, useMemorySemanticStatus, useRetrySemantic } from '../queries';
import { useModelDownloadsStore } from './modelDownloads';

// P210: semantic-search model — download prompt, download and indexing progress, or the failure
// with a retry. Hidden when the host provides no embedder.
const MODEL_BYTES = 35 * 1024 * 1024;

const status = useMemorySemanticStatus();
const install = useInstallSemanticModel();
const retry = useRetrySemantic();
const installError = computed(() => (install.isError.value ? errorText(install.error.value) : ''));
const downloads = useModelDownloadsStore();

const data = computed(() => status.data.value);
const percent = computed(() => {
  const d = data.value;
  return d && d.total > 0 ? Math.min(100, (d.done / d.total) * 100) : 0;
});

function download(): void {
  install.mutate(downloads.begin(), { onSettled: () => downloads.end() });
}
</script>

<template>
  <FieldSet
    v-if="data && data.state !== 'off'"
    data-testid="memory-semantic"
    :data-state="data.state"
  >
    <FieldLegend>{{ t('memory.semantic.title') }}</FieldLegend>
    <template v-if="data.state === 'notInstalled'">
      <FieldDescription>{{ t('memory.semantic.description') }}</FieldDescription>
      <Alert v-if="installError" variant="error" data-testid="memory-semantic-error">
        <AlertDescription>{{ installError }}</AlertDescription>
      </Alert>
      <Button
        variant="dialog"
        size="kira-lg"
        class="self-start"
        data-testid="memory-semantic-download"
        @click="download"
      >
        {{ t('memory.semantic.download.label', { size: formatBytes(MODEL_BYTES) }) }}
      </Button>
    </template>
    <template v-else-if="data.state === 'downloading'">
      <FieldDescription>{{
        t('memory.semantic.downloading.status', {
          done: formatBytes(data.done),
          total: formatBytes(data.total),
        })
      }}</FieldDescription>
      <Progress :model-value="percent" />
      <Button
        variant="dialog"
        size="kira-lg"
        class="self-start"
        data-testid="memory-semantic-cancel"
        @click="downloads.cancel()"
      >
        {{ t('common.action.cancel.label') }}
      </Button>
    </template>
    <template v-else-if="data.state === 'indexing'">
      <FieldDescription>{{
        t('memory.semantic.indexing.status', { done: data.done, total: data.total })
      }}</FieldDescription>
      <Progress :model-value="percent" />
    </template>
    <template v-else-if="data.state === 'unavailable'">
      <Alert variant="error" data-testid="memory-semantic-error">
        <AlertDescription>{{
          t('memory.semantic.unavailable.error', { message: data.message })
        }}</AlertDescription>
      </Alert>
      <Button
        variant="dialog"
        size="kira-lg"
        class="self-start"
        data-testid="memory-semantic-retry"
        @click="retry.mutate()"
      >
        {{ t('common.action.retry.label') }}
      </Button>
    </template>
    <FieldDescription v-else>{{
      data.model
        ? t('memory.semantic.onWithModel.status', { model: data.model })
        : t('memory.semantic.on.status')
    }}</FieldDescription>
  </FieldSet>
</template>
