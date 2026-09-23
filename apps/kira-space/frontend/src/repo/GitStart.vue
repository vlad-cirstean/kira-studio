<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertAction, AlertTitle } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { ref } from 'vue';
import { useCodeReposStore } from '../state/coderepos';

const codeReposStore = useCodeReposStore();

// P67b §4.4: the Git module's own MainView fallback — reachable whenever Git is active with no
// repo open, mirroring workbench/panels/StudioStart.vue / api/ApiStart.vue's own front-door shape
// (a headline and one primary action), but built on EmptyState rather than hand-rolled markup,
// since there is nothing else here to say.
const importError = ref<string | null>(null);

async function onImport(): Promise<void> {
  importError.value = null;
  try {
    await codeReposStore.importRepoViaDialog();
  } catch (err) {
    importError.value = err instanceof Error ? err.message : String(err);
  }
}
</script>

<template>
  <div class="start" data-testid="git-start">
    <div class="start-inner">
      <Alert class="w-full flex-col items-center gap-1.5 border-0 bg-transparent text-center">
        <CodiconIcon name="source-control" :size="24" class="text-subtle" />
        <AlertTitle class="text-kira-md font-normal text-muted">No repository open</AlertTitle>
        <AlertAction class="static mt-1 flex flex-col items-center gap-1.5">
          <Button variant="dialog-primary" size="kira-lg" data-testid="git-start-import" @click="onImport">
            <CodiconIcon name="repo" :size="13" />
            Import repository…
          </Button>
          <span v-if="importError" class="text-kira-xs error-note">{{ importError }}</span>
        </AlertAction>
      </Alert>
    </div>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.start {
  @apply flex-1 min-h-0 flex items-center justify-center overflow-auto p-4;
}

.start-inner {
  @apply w-105 max-w-full;
}

.error-note {
  @apply text-error;
}
</style>
