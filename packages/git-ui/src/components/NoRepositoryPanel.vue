<script setup lang="ts">
import type { RepoCandidate } from '@kira/git-ipc';
/**
 * §6.2's "no repository open" state: "the repo picker, prompted, and nothing else." The main
 * content area itself when there is nothing else to show — renders the candidate list inline.
 * G-UX D4: the workspace's own folders are the only source of repositories — when none of them
 * is a Git repository, this panel says so plainly instead of offering a folder-picking dialog.
 * P72: this is now the only repo-switch affordance git-ui ships (the toolbar dropdown, which
 * duplicated this list behind a popup, was removed — redundant with Studio's own left sidebar and
 * VS Code's one-repo-per-window model).
 */
import { TransportError } from '@kira/git-ipc';
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

// P108 F10: this was `@click`-bound directly — Vue's own async-error handling stops the
// rejection from becoming a true unhandled one, but with no `app.config.errorHandler` set it
// never reached the user either.
const pickError = ref<string | undefined>(undefined);

async function openCandidate(candidate: RepoCandidate): Promise<void> {
  pickError.value = undefined;
  try {
    const result = await props.repoState.open(candidate.path);
    if (result.kind === 'ok') emit('repo-opened', result.repo.repoId);
  } catch (err) {
    // `transport-closed` (the host disconnecting mid-request) is ignored outright — this panel
    // is about to be replaced by the boot-error banner (F8) rather than needing its own copy of it.
    if (err instanceof TransportError && err.code === 'transport-closed') return;
    pickError.value = err instanceof Error ? err.message : String(err);
  }
}
</script>

<template>
  <div
    class="kv:flex kv:flex-col kv:items-center kv:justify-center kv:gap-2 kv:h-full kv:p-4 kv:text-fg"
    data-testid="no-repository-panel"
  >
    <span
      class="codicon kv:text-[32px] kv:text-muted"
      :class="STATE_ICONS.repo"
      aria-hidden="true"
    ></span>
    <h2 class="kv:m-0 kv:text-lg kv:font-semibold">Open a repository</h2>
    <ul
      v-if="repoState.candidates.value.length > 0"
      class="kv:flex kv:flex-col kv:gap-0.5 kv:m-0 kv:p-0 kv:list-none kv:max-w-[420px] kv:w-full"
    >
      <li v-for="candidate in repoState.candidates.value" :key="candidate.path">
        <!-- P108 F4: disabled while any open (this candidate, another candidate, the bootstrap
             loop, a worktree switch elsewhere) is in flight — `RepoState.open`'s own sequence
             token already discards whichever one loses the race, but a second click before that
             is just wasted work and a confusing "which one did I pick" moment. -->
        <KuiButton
          class="kv:w-full kv:text-left kv:overflow-hidden kv:text-ellipsis kv:whitespace-nowrap"
          :disabled="repoState.opening.value"
          @click="openCandidate(candidate)"
        >
          {{ candidate.label }}
        </KuiButton>
      </li>
    </ul>
    <template v-else>
      <p
        v-if="refreshError"
        class="kv:max-w-[420px] kv:m-0 kv:text-muted kv:text-center"
        data-testid="no-repository-refresh-error"
      >
        Couldn't check this workspace's folders for a Git repository — {{ refreshError }}.
      </p>
      <p v-else class="kv:max-w-[420px] kv:m-0 kv:text-muted kv:text-center">
        Kira Space follows the folders open in this VS Code window. None of them is a Git
        repository — open one with File → Open Folder.
      </p>
      <KuiButton v-if="refreshError" data-testid="no-repository-retry" @click="refreshCandidates">
        Retry
      </KuiButton>
    </template>
    <p
      v-if="pickError"
      class="kv:max-w-[420px] kv:m-0 kv:text-muted kv:text-center"
      data-testid="no-repository-pick-error"
    >
      Couldn't open that repository — {{ pickError }}.
    </p>
  </div>
</template>
