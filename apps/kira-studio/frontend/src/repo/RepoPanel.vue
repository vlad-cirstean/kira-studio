<script setup lang="ts">
import { repoIdOfWorkspace } from '@shared/domain/workspace';
import { computed, onMounted, onUnmounted, reactive } from 'vue';
import { registerCommand } from '../shortcuts/commands';
import { codeRepoRecord } from '../state/coderepos';
import { workspaceState } from '../state/workspace';
import IconButton from '../theme/primitives/IconButton.vue';
import PanelShell from '../theme/primitives/PanelShell.vue';
import SegmentedControl from '../theme/primitives/SegmentedControl.vue';
import RepoFileTree from './RepoFileTree.vue';
import RepoSearchView from './RepoSearchView.vue';
import { refreshRepoTree, repoTreeError, repoTreeTruncated } from './state/fileTree';
import { repoSearchView, setRepoSearchView } from './state/search';

// C5 §3.4/§7: the repo workspace's own left panel — PanelShell (same shell ProjectPanel.vue uses)
// plus the file tree (or, C7's own Files/Search switch, D9, the search view). `repoId` is derived
// from the active workspace rather than a prop: this component is mounted by WorkbenchShell for
// whichever workspace key is active, and never for two repos at once.
const repoId = computed(() => repoIdOfWorkspace(workspaceState.active) ?? '');
const repoName = computed(() => codeRepoRecord(repoId.value)?.name ?? '');

const local = reactive({ search: '' });

// C7 D9: lives in repo/state/search.ts, not component state, so switching workspaces and back
// does not reset it.
const view = computed({
  get: () => repoSearchView(repoId.value),
  set: (v: 'files' | 'search') => setRepoSearchView(repoId.value, v),
});
const viewOptions = [
  { value: 'files' as const, label: 'Files', testid: 'repo-view-files' },
  { value: 'search' as const, label: 'Search', testid: 'repo-view-search' },
];

function onRefresh(): void {
  void refreshRepoTree(repoId.value);
}

// C7 S10: `repo.search`'s own palette entry (shortcuts/state.ts) — this panel is the whole of a
// repo workspace's own left panel, mounted for as long as that workspace is open, so there is no
// tab-scoping question the way view.find's per-view registration has.
let unregisterSearchCommand: (() => void) | null = null;
onMounted(() => {
  unregisterSearchCommand = registerCommand('repo.search', () => {
    view.value = 'search';
  });
});
onUnmounted(() => {
  unregisterSearchCommand?.();
  unregisterSearchCommand = null;
});
</script>

<template>
  <PanelShell
    :search="local.search"
    :empty="false"
    :searchable="view === 'files'"
    @update:search="local.search = $event"
  >
    <template #title>
      <span>{{ repoName }}</span>
    </template>
    <template #actions>
      <SegmentedControl v-model="view" :options="viewOptions" />
      <!-- Files mode only: in Search mode the panel's own tree filter is meaningless, and a
           tree refresh has nothing to do with a search result list. -->
      <IconButton
        v-if="view === 'files'"
        icon="refresh"
        aria-label="Refresh"
        v-tooltip="'Refresh file tree'"
        data-testid="repo-refresh"
        @click="onRefresh"
      />
    </template>
    <template #body>
      <div class="repo-panel-body">
        <template v-if="view === 'files'">
          <div
            v-if="repoTreeError(repoId)"
            class="p-strip note error-note"
            data-testid="repo-tree-error"
          >
            {{ repoTreeError(repoId) }}
          </div>
          <div
            v-if="repoTreeTruncated(repoId)"
            class="p-strip note"
            data-testid="repo-tree-truncated"
          >
            Showing the first 200,000 files.
          </div>
          <!-- Always mounted, never gated on isRepoTreeLoaded — RepoFileTree's own onMounted is
               what calls ensureRepoTreeLoaded in the first place; gating on the state it sets
               would mean it never gets the chance to. Its own `rows` computed is empty until the
               load resolves, then updates reactively — no separate loading placeholder needed for
               a first open this fast. -->
          <RepoFileTree class="repo-tree" :repo-id="repoId" :search="local.search" />
        </template>
        <RepoSearchView v-else class="repo-tree" :repo-id="repoId" />
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
