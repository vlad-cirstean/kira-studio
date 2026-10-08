<script setup lang="ts">
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { FieldDescription, FieldLegend, FieldSet } from '@theme/components/ui/field';
import { Progress } from '@theme/components/ui/progress';
import { computed } from 'vue';
import { useInstallSemanticModel, useMemorySemanticStatus, useRetrySemantic } from '../queries';
import { useModelDownloadsStore } from './modelDownloads';

// P210: semantic-search model — download prompt, download and indexing progress, or the failure
// with a retry. Hidden when the host provides no embedder.
const MB = 1024 * 1024;

const status = useMemorySemanticStatus();
const install = useInstallSemanticModel();
const retry = useRetrySemantic();
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
  <FieldSet v-if="data && data.state !== 'off'" data-testid="memory-semantic" :data-state="data.state">
    <FieldLegend>Semantic search</FieldLegend>
    <template v-if="data.state === 'notInstalled'">
      <FieldDescription>Finds memories by meaning. Runs a local embedding model.</FieldDescription>
      <Alert v-if="install.isError.value" variant="destructive" class="w-auto" data-testid="memory-semantic-error">
        <AlertDescription>{{ install.error.value?.message }}</AlertDescription>
      </Alert>
      <Button variant="dialog" size="kira-lg" class="self-start" data-testid="memory-semantic-download" @click="download">
        Download model (35 MB)
      </Button>
    </template>
    <template v-else-if="data.state === 'downloading'">
      <FieldDescription>Downloading {{ (data.done / MB).toFixed(0) }} / {{ (data.total / MB).toFixed(0) }} MB</FieldDescription>
      <Progress :model-value="percent" />
      <Button
        variant="dialog"
        size="kira-lg"
        class="self-start"
        data-testid="memory-semantic-cancel"
        @click="downloads.cancel()"
      >
        Cancel
      </Button>
    </template>
    <template v-else-if="data.state === 'indexing'">
      <FieldDescription>Indexing {{ data.done }} / {{ data.total }}</FieldDescription>
      <Progress :model-value="percent" />
    </template>
    <template v-else-if="data.state === 'unavailable'">
      <Alert variant="destructive" class="w-auto" data-testid="memory-semantic-error">
        <AlertDescription>Semantic search unavailable: {{ data.message }}</AlertDescription>
      </Alert>
      <Button variant="dialog" size="kira-lg" class="self-start" data-testid="memory-semantic-retry" @click="retry.mutate()">
        Retry
      </Button>
    </template>
    <FieldDescription v-else>On{{ data.model ? ` (${data.model})` : '' }}</FieldDescription>
  </FieldSet>
</template>
