<script setup lang="ts">
import { Alert, AlertDescription, AlertTitle } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { useIntervalFn } from '@vueuse/core';
import { computed, ref } from 'vue';
import { useCodeReposStore } from '../state/coderepos';
import { useSettingsStore } from '../state/settings';
import AdeMainLine from './AdeMainLine.vue';
import AdeProjectHeader from './AdeProjectHeader.vue';
import { useAdePrs, useAdeSessions, useAdeSnapshot } from './queries';
import { useAgentSessionsStore } from './state/agentSessions';
import { useQueue } from './useQueue';

// P129 Part 3 §2.7: queries for its own repo, `computed(() => useQueue({...}))`, sticky header and
// `main` line — nothing below them in Part 3, the timeline is Part 5's.
const props = defineProps<{ codeRepoId: string }>();

const codeReposStore = useCodeReposStore();
const settingsStore = useSettingsStore();
const agentSessionsStore = useAgentSessionsStore();

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
const today = computed(() => {
  const d = now.value;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
});

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
  });
});
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
        />
      </div>
    </template>
  </div>
</template>
