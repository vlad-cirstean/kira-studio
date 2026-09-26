<script setup lang="ts">
import TabStripNewButton from '@workbench/components/TabStripNewButton.vue';
import { computed } from 'vue';
import { useCodeReposStore } from '../state/coderepos';
import { openRepoTerminalTab } from '../state/repoTabs';
import { GENERAL_WORKSPACE, useWorkspaceStore } from '../state/workspace';

// P128 §2.6: the Git module's own tab-strip "+" — a terminal at the active repository's own root,
// moved verbatim (label/tooltip/click target) off WorkbenchShell.vue onto the shared
// TabStripNewButton (P128 §2.3), which both apps' own "+" already used identical markup for.
const workspaceStore = useWorkspaceStore();
const codeReposStore = useCodeReposStore();

const visible = computed(() => workspaceStore.active !== GENERAL_WORKSPACE);

function onClick(): void {
  const repoId = workspaceStore.active;
  if (repoId === GENERAL_WORKSPACE) return;
  // Not the pinned repo-graph tab's own `path` — that field holds the workspace key (== repoId),
  // not a filesystem path. The repo's real root lives on its own codeRepoRecord.
  const record = codeReposStore.records.find((r) => r.id === repoId);
  if (!record) return;
  openRepoTerminalTab(repoId, record.root);
}
</script>

<template>
  <TabStripNewButton
    v-if="visible"
    label="New terminal"
    tooltip="New terminal at repository root"
    @click="onClick"
  />
</template>
