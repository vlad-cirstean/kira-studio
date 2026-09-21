<script setup lang="ts">
import { ref } from 'vue';
import { useCodeReposStore } from '../state/coderepos';
import CodiconIcon from '../theme/CodiconIcon.vue';
import EmptyState from '../theme/primitives/EmptyState.vue';

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
.start {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--kira-s-6);
  overflow: auto;
}

.start-inner {
  width: 420px;
  max-width: 100%;
}

.error-note {
  color: var(--kira-error);
}
</style>
