<script setup lang="ts">
import { Alert, AlertDescription, AlertTitle } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { useIntervalFn } from '@vueuse/core';
import { computed, ref } from 'vue';
import { useCodeReposStore } from '../state/coderepos';
import { useSettingsStore } from '../state/settings';
import AdeClaudeDialog from './AdeClaudeDialog.vue';
import AdeMainLine from './AdeMainLine.vue';
import AdeProjectHeader from './AdeProjectHeader.vue';
import { type DialogCtx, rebaseAllSpec } from './dialogCompose';
import { localIso, localIsoOfMs } from './localDay';
import { useAdePrs, useAdeSessions, useAdeSnapshot } from './queries';
import { useAdeActionsStore } from './state/adeActions';
import { useAdeUiStore } from './state/adeUi';
import { useAgentSessionsStore } from './state/agentSessions';
import { useQueue } from './useQueue';

// P129 Part 3 §2.7: queries for its own repo, `computed(() => useQueue({...}))`, sticky header and
// `main` line — nothing below them in Part 3, the timeline is Part 5's. P129 Part 4 §2.7 adds:
// `rebasing` into `useQueue`, the `AdeClaudeDialog` mount and its own `useDialogContext`, and
// Rebase all wired from `AdeMainLine`.
const props = defineProps<{ codeRepoId: string }>();

const codeReposStore = useCodeReposStore();
const settingsStore = useSettingsStore();
const agentSessionsStore = useAgentSessionsStore();
const adeUiStore = useAdeUiStore();
const adeActionsStore = useAdeActionsStore();

const snapshotQuery = useAdeSnapshot(() => props.codeRepoId);
const prsQuery = useAdePrs(() => props.codeRepoId);
const sessionsQuery = useAdeSessions();

// §0.6: `QueueInput.today` is a **local** `YYYY-MM-DD`, never `toISOString()` (UTC) — recomputed
// every minute. `useNow`'s own options have no `interval` (only `controls`/`scheduler`,
// `@vueuse/core`'s own UseNowOptions/ConfigurableScheduler) — `useIntervalFn` + a plain ref is this
// codebase's own precedent for a periodic tick (packages/workbench/src/util/usePendingDecision.ts).
const now = ref(new Date());
useIntervalFn(() => {
  now.value = new Date();
}, 60_000);
const today = computed(() => localIso(now.value));

const repoSessions = computed(() =>
  (sessionsQuery.data.value?.sessions ?? []).filter((s) => s.codeRepoId === props.codeRepoId),
);

const projectName = computed(
  () => codeReposStore.codeRepoRecord(props.codeRepoId)?.name ?? props.codeRepoId,
);

const view = computed(() => {
  const snapshot = snapshotQuery.data.value;
  if (!snapshot) return null;
  return useQueue({
    snapshot,
    sessions: repoSessions.value,
    activity: agentSessionsStore.activity,
    prs: prsQuery.data.value,
    settings: settingsStore.ade,
    today: today.value,
    localDayOf: localIsoOfMs,
    rebasing: adeActionsStore.rebasingFor(props.codeRepoId),
  });
});

// §2.7: built once here, read by both the Rebase all opener below and `AdeClaudeDialog`'s own
// `composeDialog` call (passed down as a prop) — `null` until the snapshot/queue view are loaded,
// same guard `view` above already has.
const dialogCtx = computed<DialogCtx | null>(() => {
  const snapshot = snapshotQuery.data.value;
  const queueView = view.value;
  if (!snapshot || !queueView) return null;
  return {
    view: queueView,
    snapshot,
    sessions: repoSessions.value,
    today: today.value,
    repoRoot: codeReposStore.codeRepoRecord(props.codeRepoId)?.root ?? '',
  };
});

// §0.20: shown iff there's a behind root to rebase and this repo has nothing already in flight.
const canRebaseAll = computed(
  () =>
    (view.value?.behindRoots.length ?? 0) > 0 &&
    adeActionsStore.rebasingFor(props.codeRepoId).size === 0,
);

function onRebaseAll(): void {
  const ctx = dialogCtx.value;
  if (!ctx) return;
  adeUiStore.openDialog(rebaseAllSpec(ctx));
}

// §0.17: a background failure (archive after Stop, blocked, ended) surfaces here, under the
// `main` line — Space has no toast system, and by the time these land the dialog that started
// them is already closed.
const actionError = computed(() => adeActionsStore.actionError.get(props.codeRepoId) ?? null);
function onDismissError(): void {
  adeActionsStore.dismissError(props.codeRepoId);
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-auto" data-testid="ade-repo-view">
    <template v-if="snapshotQuery.isError.value">
      <Alert variant="destructive" class="m-4" data-testid="ade-snapshot-error">
        <AlertTitle>Couldn't load this repository's agent queue</AlertTitle>
        <AlertDescription>{{ (snapshotQuery.error.value as Error | null)?.message }}</AlertDescription>
        <Button variant="dialog" size="sm" class="mt-2" @click="() => snapshotQuery.refetch()">
          Retry
        </Button>
      </Alert>
    </template>
    <template v-else-if="!snapshotQuery.data.value">
      <p class="p-4 text-muted-foreground" data-testid="ade-repo-loading">Loading…</p>
    </template>
    <template v-else>
      <div class="sticky top-0 z-10 bg-bg pt-2.5">
        <AdeProjectHeader
          :code-repo-id="codeRepoId"
          :project-name="projectName"
          :last-fetch-at="snapshotQuery.data.value.lastFetchAt ?? null"
          :autofetch-minutes="snapshotQuery.data.value.autofetchMinutes"
        />
        <AdeMainLine
          :main-name="snapshotQuery.data.value.main?.name ?? null"
          :behind-count="view?.behindRoots.length ?? 0"
          :can-rebase-all="canRebaseAll"
          @rebase-all="onRebaseAll"
        />
      </div>
      <Alert
        v-if="actionError"
        variant="destructive"
        class="mx-4 my-2"
        data-testid="ade-action-error"
      >
        <AlertDescription class="flex items-center gap-2">
          <span class="flex-1">{{ actionError }}</span>
          <Button variant="link" size="sm" data-testid="ade-action-error-dismiss" @click="onDismissError">
            Dismiss
          </Button>
        </AlertDescription>
      </Alert>
    </template>
    <AdeClaudeDialog :code-repo-id="codeRepoId" :ctx="dialogCtx" />
  </div>
</template>
