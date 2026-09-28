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
import { ref, watch } from 'vue';
import { useCodeReposStore } from '../state/coderepos';
import AdeAllAgentsView from './AdeAllAgentsView.vue';
import AdeRepoTabs from './AdeRepoTabs.vue';
import AdeRepoView from './AdeRepoView.vue';
import { useAdeUiStore } from './state/adeUi';

// P129 Part 3 §0.12/§0.15/§2.1/§2.7: the `ade` module's own full-area root
// (`packages/workbench/src/modes.ts`'s `FullModeDef.view`) — repo tabs, then the active repo's own
// view, or the §0.19 empty state when nothing is imported yet.
const codeReposStore = useCodeReposStore();
const adeUiStore = useAdeUiStore();
const importError = ref<string | null>(null);

// §0.15: "defaulting to the first record" — re-run whenever the record list changes, so a repo
// imported while `ade` is active, or the active repo being removed, both resolve to a still-valid
// tab rather than a stale id `AdeRepoTabs`/`AdeRepoView` no longer recognise.
watch(
  () => codeReposStore.records,
  (records) => {
    if (records.some((r) => r.id === adeUiStore.activeRepoId)) return;
    adeUiStore.setActiveRepo(records[0]?.id ?? '');
  },
  { immediate: true },
);

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
  <div class="flex min-h-0 flex-1 flex-col" data-testid="ade-view">
    <template v-if="codeReposStore.records.length === 0">
      <Empty class="flex-1">
        <EmptyMedia variant="icon">
          <CodiconIcon name="robot" :size="20" />
        </EmptyMedia>
        <EmptyContent>
          <EmptyTitle>No repository imported yet</EmptyTitle>
          <EmptyDescription>Import a repository to start queuing agent work.</EmptyDescription>
          <Button variant="dialog-primary" size="kira-lg" data-testid="ade-import" @click="onImport">
            <CodiconIcon name="repo" :size="13" />
            Import repository…
          </Button>
          <span v-if="importError" class="text-kira-sm text-error">{{ importError }}</span>
        </EmptyContent>
      </Empty>
    </template>
    <template v-else>
      <AdeRepoTabs />
      <AdeAllAgentsView v-if="adeUiStore.allAgents" />
      <AdeRepoView
        v-else-if="adeUiStore.activeRepoId"
        :key="adeUiStore.activeRepoId"
        :code-repo-id="adeUiStore.activeRepoId"
      />
    </template>
  </div>
</template>
