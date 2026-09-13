<script setup lang="ts">
import { repoIdOfWorkspace } from '@shared/domain/workspace';
import { computed, reactive } from 'vue';
import { codeRepoRecord } from '../state/coderepos';
import { workspaceState } from '../state/workspace';
import IconButton from '../theme/primitives/IconButton.vue';
import PanelShell from '../theme/primitives/PanelShell.vue';
import RepoFileTree from './RepoFileTree.vue';
import { refreshRepoTree, repoTreeError, repoTreeTruncated } from './state/fileTree';

// C5 §3.4/§7: the repo workspace's own left panel — PanelShell (same shell ProjectPanel.vue uses)
// plus the file tree. `repoId` is derived from the active workspace rather than a prop: this
// component is mounted by WorkbenchShell for whichever workspace key is active, and never for two
// repos at once.
const repoId = computed(() => repoIdOfWorkspace(workspaceState.active) ?? '');
const repoName = computed(() => codeRepoRecord(repoId.value)?.name ?? '');

const local = reactive({ search: '' });

function onRefresh(): void {
  void refreshRepoTree(repoId.value);
}
</script>

<template>
  <PanelShell :search="local.search" :empty="false" @update:search="local.search = $event">
    <template #title>
      <span>{{ repoName }}</span>
    </template>
    <template #actions>
      <IconButton
        icon="refresh"
        aria-label="Refresh"
        v-tooltip="'Refresh file tree'"
        data-testid="repo-refresh"
        @click="onRefresh"
      />
    </template>
    <template #body>
      <div class="repo-panel-body">
        <div v-if="repoTreeError(repoId)" class="p-strip note error-note" data-testid="repo-tree-error">
          {{ repoTreeError(repoId) }}
        </div>
        <div
          v-if="repoTreeTruncated(repoId)"
          class="p-strip note"
          data-testid="repo-tree-truncated"
        >
          Showing the first 200,000 files.
        </div>
        <!-- Always mounted, never gated on isRepoTreeLoaded — RepoFileTree's own onMounted is what
             calls ensureRepoTreeLoaded in the first place; gating on the state it sets would mean
             it never gets the chance to. Its own `rows` computed is empty until the load resolves,
             then updates reactively — no separate loading placeholder needed for a first open this
             fast. -->
        <RepoFileTree class="repo-tree" :repo-id="repoId" :search="local.search" />
      </div>
    </template>
  </PanelShell>
</template>

<style scoped>
.repo-panel-body {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.repo-tree {
  flex: 1;
  min-height: 0;
}

.error-note {
  color: var(--kira-error);
}
</style>
