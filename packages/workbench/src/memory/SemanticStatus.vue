<script setup lang="ts">
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Progress } from '@theme/components/ui/progress';
import { computed } from 'vue';
import { useInstallSemanticModel, useMemorySemanticStatus, useRetrySemantic } from './queries';

// P210: semantic-search status row — download prompt, download and indexing progress, or the
// failure with a retry. Hidden when the host provides no embedder.
const MB = 1024 * 1024;

const status = useMemorySemanticStatus();
const install = useInstallSemanticModel();
const retry = useRetrySemantic();

const data = computed(() => status.data.value);
const percent = computed(() => {
  const d = data.value;
  return d && d.total > 0 ? Math.min(100, (d.done / d.total) * 100) : 0;
});

let abort: AbortController | null = null;
function download(): void {
  abort = new AbortController();
  install.mutate(abort.signal);
}
function cancel(): void {
  abort?.abort();
}
</script>

<template>
  <div
    v-if="data && data.state !== 'off'"
    class="flex flex-col gap-1 text-kira-sm text-muted-foreground"
    data-testid="memory-semantic"
    :data-state="data.state"
  >
    <template v-if="data.state === 'notInstalled'">
      <div class="flex items-center gap-1.5">
        <span class="min-w-0 flex-1">Semantic search off</span>
        <Button size="xs" variant="outline" data-testid="memory-semantic-download" @click="download">
          Download model (35 MB)
        </Button>
      </div>
      <Alert v-if="install.isError.value" variant="destructive" class="w-auto" data-testid="memory-semantic-error">
        <AlertDescription>{{ install.error.value?.message }}</AlertDescription>
      </Alert>
    </template>
    <template v-else-if="data.state === 'downloading'">
      <div class="flex items-center gap-1.5">
        <span class="min-w-0 flex-1">
          Downloading {{ (data.done / MB).toFixed(0) }} / {{ (data.total / MB).toFixed(0) }} MB
        </span>
        <Button size="xs" variant="outline" data-testid="memory-semantic-cancel" @click="cancel">Cancel</Button>
      </div>
      <Progress :model-value="percent" />
    </template>
    <template v-else-if="data.state === 'indexing'">
      <span>Indexing {{ data.done }} / {{ data.total }}</span>
      <Progress :model-value="percent" />
    </template>
    <template v-else-if="data.state === 'unavailable'">
      <Alert variant="destructive" class="w-auto" data-testid="memory-semantic-error">
        <AlertDescription>Semantic search unavailable: {{ data.message }}</AlertDescription>
      </Alert>
      <Button size="xs" variant="outline" class="self-start" data-testid="memory-semantic-retry" @click="retry.mutate()">
        Retry
      </Button>
    </template>
    <span v-else>Semantic search on</span>
  </div>
</template>
