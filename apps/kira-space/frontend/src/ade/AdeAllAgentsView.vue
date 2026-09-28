<script setup lang="ts">
import { useQueries } from '@tanstack/vue-query';
import { ToggleGroup, ToggleGroupItem } from '@theme/components/ui/toggle-group';
import { computed, ref } from 'vue';
import { useCodeReposStore } from '../state/coderepos';
import { useSettingsStore } from '../state/settings';
import { useTerminalsStore } from '../state/terminals';
import AdeActivityIcon from './AdeActivityIcon.vue';
import AdeAllAgentsRow from './AdeAllAgentsRow.vue';
import AdeClaudeDialog from './AdeClaudeDialog.vue';
import { ACTIVITY_LABEL, type ActivityKind } from './activity';
import { type AllAgentsRepoInput, type AllAgentsRow, buildAllAgents } from './allAgents';
import { type DialogCtx, resumeSpec } from './dialogCompose';
import { localIso, localIsoOfMs } from './localDay';
import { useAdeFocusSession } from './mutations';
import { adePrsOptions, adeSnapshotOptions, useAdeSessions } from './queries';
import { useAdeUiStore } from './state/adeUi';
import { useAgentSessionsStore } from './state/agentSessions';
import { useQueue } from './useQueue';
import type { AdeRepoPrs, AdeRepoSnapshot } from './wire';

// P129 Part 7 §0.1/§0.5/§2.4: the pinned "All agents" tab's own view (mockup 47-85) — filter,
// aggregated activity line, groups, one row per session. `useNow` is not needed here (§0.5): unlike
// `AdeRepoView`'s own timeline, nothing here renders relative to a periodically-advancing clock — a
// stale `today` by a day would only ever affect `useQueue`'s own bands/segments/effDay, none of
// which `allAgents.ts`'s own row join reads (title/colour/branchText come from stages 1-2 only).
// §0.8 wires same-window Open; cross-window Open (§0.9) lands in a later commit. §0.10 wires the
// Start dialog for a non-running row.
const codeReposStore = useCodeReposStore();
const settingsStore = useSettingsStore();
const adeUiStore = useAdeUiStore();
const agentSessionsStore = useAgentSessionsStore();
const terminalsStore = useTerminalsStore();
const sessionsQuery = useAdeSessions();

const today = computed(() => localIso(new Date()));

const sessions = computed(() => sessionsQuery.data.value?.sessions ?? []);

// §0.5: only repos with at least one session pay for a snapshot/prs fetch — a repo never opened
// this session (no queued work, no launched agent) has nothing for the join to show anyway (its
// own `sessions` filter below is always empty), so `buildAllAgents` drops its group regardless.
const reposWithSessions = computed(() => {
  const withSessions = new Set(sessions.value.map((s) => s.codeRepoId));
  return codeReposStore.records.filter((r) => withSessions.has(r.id));
});

// §0.5: one flat query list, two entries per repo (snapshot, then prs) — read back in pairs below,
// the same option factories `useAdeSnapshot`/`useAdePrs` build on, so the cache entry is shared with
// whichever repo tab a session's own repo is opened on.
const snapshotAndPrsQueries = useQueries({
  queries: () =>
    reposWithSessions.value.flatMap((r) => [adeSnapshotOptions(r.id), adePrsOptions(r.id)]),
});

const reposInput = computed<AllAgentsRepoInput[]>(() => {
  const withSessions = reposWithSessions.value;
  const results = snapshotAndPrsQueries.value;
  const byRepo = new Map<string, { snapshot: AdeRepoSnapshot | null; prs: AdeRepoPrs | undefined }>();
  withSessions.forEach((r, i) => {
    byRepo.set(r.id, {
      snapshot: (results[i * 2]?.data as AdeRepoSnapshot | undefined) ?? null,
      prs: results[i * 2 + 1]?.data as AdeRepoPrs | undefined,
    });
  });
  return codeReposStore.records.map((r) => {
    const repoSessions = sessions.value.filter((s) => s.codeRepoId === r.id);
    const entry = byRepo.get(r.id);
    const snapshot = entry?.snapshot ?? null;
    const view = snapshot
      ? useQueue({
          snapshot,
          sessions: repoSessions,
          activity: agentSessionsStore.activity,
          prs: entry?.prs,
          settings: settingsStore.ade,
          today: today.value,
          localDayOf: localIsoOfMs,
        })
      : null;
    return { codeRepoId: r.id, name: r.name, view, snapshot, sessions: repoSessions };
  });
});

const filter = computed<'active' | 'older'>(() => settingsStore.ade.allAgentsFilter);

const allAgents = computed(() =>
  buildAllAgents(reposInput.value, agentSessionsStore.activity, filter.value),
);

/** §0.7: `ToggleGroup`'s own `update:model-value` fires `''` when the active item is clicked again
 *  (deselecting it) — ignored, so one filter item always stays selected (mockup has no "neither"
 *  state). */
function onFilterChange(value: unknown): void {
  if (value !== 'active' && value !== 'older') return;
  void settingsStore.patchSettings({ ade: { allAgentsFilter: value } });
}

const summaryEntries = computed(() => {
  const s = allAgents.value.summary;
  const kinds: ActivityKind[] = ['input', 'working', 'waiting'];
  return kinds
    .filter((k) => s[k as 'input' | 'working' | 'waiting'] > 0)
    .map((k) => ({ kind: k, count: s[k as 'input' | 'working' | 'waiting'], label: ACTIVITY_LABEL[k] }));
});

const focusSessionMutation = useAdeFocusSession();

function openLocal(row: AllAgentsRow): void {
  adeUiStore.showRepo(row.codeRepoId);
  if (row.itemId !== null) adeUiStore.openSession(row.codeRepoId, row.itemId, row.sessionId);
}

// §0.8/§0.9: `terminalsStore.terminalSession` is truthy exactly when this window owns the row's
// own PTY — that case goes straight to the local path. Everything else tries the owning window's
// own FocusSession first (cross-window Open); a `false` result (the owner closed, or the session
// stopped between render and click) falls back to the same local path, which then shows its
// existing `Running in another window.` line until the next `kira:ade:sessions` refresh.
function onOpen(row: AllAgentsRow): void {
  if (terminalsStore.terminalSession(row.terminalId)) {
    openLocal(row);
    return;
  }
  void focusSessionMutation
    .mutateAsync({ sessionId: row.sessionId, itemId: row.itemId ?? '' })
    .then((focused) => {
      if (!focused) openLocal(row);
    });
}

// §0.10: the one dialog this view can open, for whichever repo Start was last clicked on — set only
// on Start, never cleared after (`AdeClaudeDialog` itself gates on `adeUiStore.dialog`, matching
// `AdeRepoView`'s own single-mount pattern; this view unmounts `AdeRepoView` while it shows, so only
// one `AdeClaudeDialog` ever exists at a time).
const dialogRepoId = ref<string | null>(null);

const dialogCtx = computed<DialogCtx | null>(() => {
  const input = reposInput.value.find((r) => r.codeRepoId === dialogRepoId.value);
  if (!input?.view || !input.snapshot) return null;
  return {
    view: input.view,
    snapshot: input.snapshot,
    sessions: input.sessions,
    today: today.value,
    repoRoot: codeReposStore.codeRepoRecord(input.codeRepoId)?.root ?? '',
  };
});

// §0.10: `forceNew` reads the session's own `archived`/`cwdMissing` directly (never threaded through
// the pure builder's row shape, §0.6) — an orphan (`row.itemId === null`) has no queue item, so the
// dialog's own branch target falls back to the session's `newWorkId` or its `branch` (mockup 887).
function onStart(row: AllAgentsRow): void {
  dialogRepoId.value = row.codeRepoId;
  const ctx = dialogCtx.value;
  const session = reposInput.value
    .find((r) => r.codeRepoId === row.codeRepoId)
    ?.sessions.find((s) => s.id === row.sessionId);
  if (!ctx || !session) return;
  const forceNew = row.archived || session.cwdMissing;
  const itemId = row.itemId ?? (session.newWorkId || session.branch);
  adeUiStore.openDialog(
    resumeSpec(ctx, itemId, row.sessionId, {
      askWt: true,
      wt: forceNew ? 'new' : 'same',
      noSame: forceNew,
      title: 'Start Claude Code',
    }),
  );
}
</script>

<template>
  <div class="flex-1 min-h-0 overflow-auto px-7 pb-7 pt-[18px]" data-testid="ade-all-agents-view">
    <div class="flex max-w-[1040px] flex-col gap-[18px]">
      <div class="flex items-center gap-3.5">
        <ToggleGroup
          type="single"
          :model-value="filter"
          class="rounded-kira border border-[#2a2d35] bg-[#1b1d22] p-[3px]"
          data-testid="ade-all-agents-filter"
          @update:model-value="onFilterChange"
        >
          <ToggleGroupItem
            value="active"
            class="h-7 rounded-kira-sm px-3 text-kira-sm font-semibold data-[state=on]:bg-[#2a2c33] data-[state=on]:text-fg"
          >
            Active {{ allAgents.activeN }}
          </ToggleGroupItem>
          <ToggleGroupItem
            value="older"
            class="h-7 rounded-kira-sm px-3 text-kira-sm font-semibold data-[state=on]:bg-[#2a2c33] data-[state=on]:text-fg"
          >
            Older {{ allAgents.olderN }}
          </ToggleGroupItem>
        </ToggleGroup>
        <div v-if="filter === 'active'" class="flex gap-3" data-testid="ade-all-agents-acts">
          <span
            v-for="entry in summaryEntries"
            :key="entry.kind"
            class="inline-flex items-center gap-1.5 text-kira-sm text-[#c9c7c2]"
          >
            <AdeActivityIcon :kind="entry.kind" />{{ entry.count }} {{ entry.label }}
          </span>
        </div>
      </div>

      <section
        v-for="group in allAgents.groups"
        :key="group.codeRepoId"
        class="flex flex-col gap-0.5"
        data-testid="ade-all-agents-group"
        :data-repo-id="group.codeRepoId"
      >
        <div class="mb-1 border-b border-[#22252c] px-3 pb-1.5">
          <h3 class="m-0 font-data text-kira-md font-semibold">{{ group.name }}</h3>
        </div>
        <AdeAllAgentsRow
          v-for="row in group.rows"
          :key="row.sessionId"
          :row="row"
          @open="onOpen"
          @start="onStart"
        />
      </section>

      <p v-if="allAgents.groups.length === 0" class="p-3 text-kira-sm text-[#9a9ca5]">
        Nothing here.
      </p>
    </div>
    <AdeClaudeDialog :code-repo-id="dialogRepoId ?? ''" :ctx="dialogCtx" />
  </div>
</template>
