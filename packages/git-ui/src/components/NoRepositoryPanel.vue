<script setup lang="ts">
/**
 * §6.2's "no repository open" state: "the repo picker, prompted, and nothing else." Distinct
 * from `RepoPicker.vue`'s toolbar dropdown (a small trigger button that opens a popup) — this is
 * the main content area itself when there is nothing else to show, so it renders the same
 * candidate list inline rather than behind another click. G-UX D4: the workspace's own folders
 * are the only source of repositories — when none of them is a Git repository, this panel says so
 * plainly instead of offering a folder-picking dialog.
 */
import type { RepoCandidate } from '@kira/git-ipc';
import { KuiButton } from '@kira/kira-ui';
import { onMounted } from 'vue';
import { STATE_ICONS } from '../icons/index.ts';
import type { RepoState } from '../state/repo.ts';

const props = defineProps<{ repoState: RepoState }>();
const emit = defineEmits<(event: 'repo-opened', repoId: string) => void>();

onMounted(() => {
  void props.repoState.refreshList();
});

async function openCandidate(candidate: RepoCandidate): Promise<void> {
  const result = await props.repoState.open(candidate.path);
  if (result.kind === 'ok') emit('repo-opened', result.repo.repoId);
}
</script>

<template>
  <div class="kv-no-repo-panel" data-testid="no-repository-panel">
    <span class="codicon kv-no-repo-icon" :class="STATE_ICONS.repo" aria-hidden="true"></span>
    <h2 class="kv-no-repo-title">Open a repository</h2>
    <ul v-if="repoState.candidates.value.length > 0" class="kv-no-repo-list">
      <li v-for="candidate in repoState.candidates.value" :key="candidate.path">
        <KuiButton class="kv-no-repo-candidate" @click="openCandidate(candidate)">
          {{ candidate.label }}
        </KuiButton>
      </li>
    </ul>
    <p v-else class="kv-no-repo-note">
      Kira Version follows the folders open in this VS Code window. None of them is a Git
      repository — open one with File → Open Folder.
    </p>
  </div>
</template>

<style>
.kv-no-repo-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--kv-space-3);
  height: 100%;
  padding: var(--kv-space-5);
  color: var(--kv-app-fg);
}

.kv-no-repo-icon {
  font-size: 32px;
  color: var(--kv-description-fg);
}

.kv-no-repo-title {
  margin: 0;
  font-size: 1.1em;
  font-weight: 600;
}

.kv-no-repo-list {
  display: flex;
  flex-direction: column;
  gap: var(--kv-space-1);
  margin: 0;
  padding: 0;
  list-style: none;
  max-width: 420px;
  width: 100%;
}

.kv-no-repo-candidate {
  width: 100%;
  padding: var(--kv-space-2) var(--kv-space-3);
  border: 1px solid var(--kv-panel-border);
  border-radius: var(--kv-radius);
  background: transparent;
  color: var(--kv-app-fg);
  font-family: inherit;
  font-size: inherit;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.kv-no-repo-candidate:hover {
  background-color: var(--kv-row-hover-bg);
}

.kv-no-repo-note {
  max-width: 420px;
  margin: 0;
  color: var(--kv-description-fg);
  text-align: center;
}
</style>
