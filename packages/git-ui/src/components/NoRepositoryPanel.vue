<script setup lang="ts">
import type { RepoCandidate } from '@kira/git-ipc';
/**
 * §6.2's "no repository open" state: "the repo picker, prompted, and nothing else." The main
 * content area itself when there is nothing else to show — renders the candidate list inline.
 * G-UX D4: the workspace's own folders are the only source of repositories — when none of them
 * is a Git repository, this panel says so plainly instead of offering a folder-picking dialog.
 * P72: this is now the only repo-switch affordance git-ui ships (the toolbar dropdown, which
 * duplicated this list behind a popup, was removed — redundant with Studio's own left sidebar and
 * the one-repo-per-workspace model).
 */
import { TransportError } from '@kira/git-ipc';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@theme/components/ui/empty';
import { onMounted, ref } from 'vue';
import { codiconName, STATE_ICONS } from '../icons/index.ts';
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
  <Empty class="h-full p-6" data-testid="no-repository-panel">
    <EmptyMedia variant="icon">
      <CodiconIcon :name="codiconName(STATE_ICONS.repo)" :size="24" />
    </EmptyMedia>
    <EmptyTitle class="font-semibold text-fg">Open a repository</EmptyTitle>
    <ul
      v-if="repoState.candidates.value.length > 0"
      class="flex flex-col gap-0.5 m-0 p-0 list-none max-w-105 w-full"
    >
      <li v-for="candidate in repoState.candidates.value" :key="candidate.path">
        <!-- P108 F4: disabled while any open (this candidate, another candidate, the bootstrap
             loop, a worktree switch elsewhere) is in flight — `RepoState.open`'s own sequence
             token already discards whichever one loses the race, but a second click before that
             is just wasted work and a confusing "which one did I pick" moment. -->
        <Button
          variant="toolbar"
          size="kira"
          class="w-full justify-start truncate"
          :disabled="repoState.opening.value"
          @click="openCandidate(candidate)"
        >
          {{ candidate.label }}
        </Button>
      </li>
    </ul>
    <template v-else>
      <EmptyDescription
        v-if="refreshError"
        class="max-w-105"
        data-testid="no-repository-refresh-error"
      >
        Couldn't check this workspace's folders for a Git repository — {{ refreshError }}.
      </EmptyDescription>
      <EmptyDescription v-else class="max-w-105">
        This workspace's folder is not a Git repository.
      </EmptyDescription>
      <Button
        v-if="refreshError"
        variant="toolbar"
        size="kira"
        data-testid="no-repository-retry"
        @click="refreshCandidates"
      >
        Retry
      </Button>
    </template>
    <EmptyDescription v-if="pickError" class="max-w-105" data-testid="no-repository-pick-error">
      Couldn't open that repository — {{ pickError }}.
    </EmptyDescription>
  </Empty>
</template>
