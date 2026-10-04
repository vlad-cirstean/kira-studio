<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from '@theme/components/ui/empty';
import { ref } from 'vue';
import { useCodeReposStore } from '../state/coderepos';
import AdeShell from './v2/shell/AdeShell.vue';

// The `ade` mode's root: the v2 shell, or the empty state until a repository is imported.
const codeReposStore = useCodeReposStore();
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
  <div class="flex h-full min-h-0 flex-col" data-testid="ade-view">
    <Empty v-if="codeReposStore.records.length === 0" class="flex-1">
      <EmptyMedia variant="icon">
        <CodiconIcon name="robot" :size="20" />
      </EmptyMedia>
      <EmptyContent>
        <EmptyTitle>No repository imported yet</EmptyTitle>
        <EmptyDescription>Import a repository to start planning agent work.</EmptyDescription>
        <Button variant="dialog-primary" size="kira-lg" data-testid="ade-import" @click="onImport">
          <CodiconIcon name="repo" :size="13" />
          Import repository…
        </Button>
        <span v-if="importError" class="text-kira-sm text-error">{{ importError }}</span>
      </EmptyContent>
    </Empty>
    <AdeShell v-else />
  </div>
</template>
