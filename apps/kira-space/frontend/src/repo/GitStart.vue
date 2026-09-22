<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import EmptyState from '@theme/primitives/EmptyState.vue';
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
      <EmptyState icon="source-control" label="No repository open">
        <button type="button" class="p-dlgbtn primary" data-testid="git-start-import" @click="onImport">
          <span class="icon-box"><CodiconIcon name="repo" :size="13" /></span>
          Import repository…
        </button>
        <span v-if="importError" class="p-xs error-note">{{ importError }}</span>
      </EmptyState>
    </div>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.start {
  @apply flex-1 min-h-0 flex items-center justify-center overflow-auto p-4;
}

.start-inner {
  @apply w-[420px] max-w-full;
}

.error-note {
  @apply text-error;
}
</style>
