<script setup lang="ts">
/**
 * §6.2's "no repository open" state: "the repo picker, prompted, and nothing else." The main
 * content area itself when there is nothing else to show — renders the candidate list inline.
 * G-UX D4: the workspace's own folders are the only source of repositories — when none of them
 * is a Git repository, this panel says so plainly instead of offering a folder-picking dialog.
 * P72: this is now the only repo-switch affordance git-ui ships (the toolbar dropdown, which
 * duplicated this list behind a popup, was removed — redundant with Studio's own left sidebar and
 * VS Code's one-repo-per-window model).
 */
import type { RepoCandidate } from '@kira/git-ipc';
import { KuiButton } from '@kira/kira-ui';
import { onMounted, ref } from 'vue';
import { STATE_ICONS } from '../icons/index.ts';
import type { RepoState } from '../state/repo.ts';

const props = defineProps<{ repoState: RepoState }>();
const emit = defineEmits<(event: 'repo-opened', repoId: string) => void>();

// P108 F8: this panel's own refreshList() call (independent of bootstrap()'s own) can fail too —
// distinct copy so a transport drop here never reads as "none of your folders is a Git
// repository", which is a different, host-confirmed answer this failure never actually gave.
const refreshError = ref<string | undefined>(undefined);

function refreshCandidates(): void {
  refreshError.value = undefined;
  void props.repoState.refreshList().catch((err: unknown) => {
    refreshError.value = err instanceof Error ? err.message : String(err);
  });
}

onMounted(refreshCandidates);

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
        <!-- P108 F4: disabled while any open (this candidate, another candidate, the bootstrap
             loop, a worktree switch elsewhere) is in flight — `RepoState.open`'s own sequence
             token already discards whichever one loses the race, but a second click before that
             is just wasted work and a confusing "which one did I pick" moment. -->
        <KuiButton
          class="kv-no-repo-candidate"
          :disabled="repoState.opening.value"
          @click="openCandidate(candidate)"
        >
          {{ candidate.label }}
        </KuiButton>
      </li>
    </ul>
    <template v-else>
      <p v-if="refreshError" class="kv-no-repo-note" data-testid="no-repository-refresh-error">
        Couldn't check this workspace's folders for a Git repository — {{ refreshError }}.
      </p>
      <p v-else class="kv-no-repo-note">
        Kira Space follows the folders open in this VS Code window. None of them is a Git
        repository — open one with File → Open Folder.
      </p>
      <KuiButton v-if="refreshError" data-testid="no-repository-retry" @click="refreshCandidates">
        Retry
      </KuiButton>
    </template>
  </div>
</template>

<style>
.kv-no-repo-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--kv-s-4);
  height: 100%;
  padding: var(--kv-s-6);
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
  gap: var(--kv-s-1);
  margin: 0;
  padding: 0;
  list-style: none;
  max-width: 420px;
  width: 100%;
}

/* G34: box geometry (padding/border/border-radius) no longer re-declared here — the default
   `KuiButton` box is this shape now; only the full-width-list-item layout survives. */
.kv-no-repo-candidate {
  width: 100%;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kv-no-repo-note {
  max-width: 420px;
  margin: 0;
  color: var(--kv-description-fg);
  text-align: center;
}
</style>
