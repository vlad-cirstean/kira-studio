<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { FieldDescription, FieldLegend, FieldSet } from '@theme/components/ui/field';
import { Progress } from '@theme/components/ui/progress';
import { computed } from 'vue';
import { useDictationStatus, useInstallDictationModel, useRetryDictation } from '../queries';
import { useModelDownloadsStore } from './modelDownloads';

// P216: local speech model — download prompt, progress, failure with retry. Hidden when the host
// cannot dictate.
const MB = 1024 * 1024;

const status = useDictationStatus();
const install = useInstallDictationModel();
const retry = useRetryDictation();
const downloads = useModelDownloadsStore();

const data = computed(() => status.data.value);
const percent = computed(() => {
  const d = data.value;
  return d && d.total > 0 ? Math.min(100, (d.done / d.total) * 100) : 0;
});

function download(): void {
  install.mutate(downloads.begin('dictation'), { onSettled: () => downloads.end('dictation') });
}
</script>

<template>
  <FieldSet v-if="data && data.state !== 'off'" data-testid="dictation-section" :data-state="data.state">
    <FieldLegend>Dictation</FieldLegend>
    <template v-if="data.state === 'notInstalled'">
      <FieldDescription>Dictation runs a local speech model: 182 MB download, about 340 MB RAM while in use.</FieldDescription>
      <Alert v-if="install.isError.value" variant="destructive" class="w-auto" data-testid="dictation-error">
        <AlertDescription>{{ install.error.value?.message }}</AlertDescription>
      </Alert>
      <Button variant="dialog" size="kira-lg" class="self-start" data-testid="dictation-download" @click="download">
        {{ install.isError.value ? 'Retry download' : 'Download model' }}
      </Button>
    </template>
    <template v-else-if="data.state === 'downloading'">
      <FieldDescription data-testid="dictation-progress-label">
        Downloading {{ (data.done / MB).toFixed(0) }} / {{ (data.total / MB).toFixed(0) }} MB
      </FieldDescription>
      <Progress :model-value="percent" />
      <Button
        variant="dialog"
        size="kira-lg"
        class="self-start"
        data-testid="dictation-cancel-download"
        @click="downloads.cancel('dictation')"
      >
        Cancel
      </Button>
    </template>
    <template v-else-if="data.state === 'unavailable'">
      <Alert variant="destructive" class="w-auto" data-testid="dictation-unavailable">
        <AlertDescription>Dictation unavailable: {{ data.message }}</AlertDescription>
      </Alert>
      <Button variant="dialog" size="kira-lg" class="self-start" data-testid="dictation-retry" @click="retry.mutate()">
        <CodiconIcon name="refresh" :size="12" />
        Retry
      </Button>
    </template>
    <FieldDescription v-else>Speech model installed</FieldDescription>
  </FieldSet>
</template>
