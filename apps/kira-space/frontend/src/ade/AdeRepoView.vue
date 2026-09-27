<script setup lang="ts">
import { Alert, AlertDescription, AlertTitle } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { useElementSize, useIntervalFn, useScroll } from '@vueuse/core';
import { computed, nextTick, ref } from 'vue';
import { useCodeReposStore } from '../state/coderepos';
import { useSettingsStore } from '../state/settings';
import AdeClaudeDialog from './AdeClaudeDialog.vue';
import AdeHistoryBar from './AdeHistoryBar.vue';
import AdeMainLine from './AdeMainLine.vue';
import AdeProjectHeader from './AdeProjectHeader.vue';
import AdeTimeline from './AdeTimeline.vue';
import { type DialogCtx, rebaseAllSpec } from './dialogCompose';
import { localIso, localIsoOfMs } from './localDay';
import { useAdePrs, useAdeSessions, useAdeSnapshot } from './queries';
import { useAdeActionsStore } from './state/adeActions';
import { useAdeUiStore } from './state/adeUi';
import { useAgentSessionsStore } from './state/agentSessions';
import { useHistoryPull } from './useHistoryPull';
import { isoToOffset, offsetToIso, useQueue } from './useQueue';

// P129 Part 3 §2.7: queries for its own repo, `computed(() => useQueue({...}))`, sticky header and
// `main` line — nothing below them in Part 3, the timeline is Part 5's. P129 Part 4 §2.7 adds:
// `rebasing` into `useQueue`, the `AdeClaudeDialog` mount and its own `useDialogContext`, and
// Rebase all wired from `AdeMainLine`. P129 Part 5 §0.6/§0.9 adds: `historyOpen`/`historyReach`
// (local — this view is keyed by `activeRepoId`, so a repo-tab switch remounts and resets them),
// the scroll-pull composable, the History bar and every scroll-owning navigation function.
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

// §0.6: local to this view (keyed by `activeRepoId` in `AdeView`, so a repo-tab switch remounts and
// resets both — "switching repo tabs hides history again"). `historyReach` stays `undefined` until
// a "Go to date" navigation grows it past `settings.historyDays`'s own default (`useQueue`'s own
// fallback, never written here).
const historyOpen = ref(false);
const historyReach = ref<number | undefined>(undefined);

// §0.9: the scroll container (root, `overflow-auto`) and the sticky header, whose own live height
// `scrollToDay` and `inHistory` both read via `useElementSize`.
const scrollEl = ref<HTMLElement | null>(null);
const headerEl = ref<HTMLElement | null>(null);
const { height: headerHeight } = useElementSize(headerEl);
const { y: scrollY } = useScroll(scrollEl);

// §0.7: wheel-pull-to-open, `AdeTimeline`'s own closed pull row reads `pull`/`pct`.
const { pull, pct } = useHistoryPull(scrollEl, historyOpen, () => void openHistory());

// §0.9 "Opening keeps position": record the pre-open `scrollHeight`, open, wait a render, then land
// 60px into the newly revealed history so the fold isn't flush against it.
async function openHistory(): Promise<void> {
  const el = scrollEl.value;
  if (!el) return;
  const before = el.scrollHeight;
  historyOpen.value = true;
  await nextTick();
  el.scrollTop = el.scrollHeight - before - 60;
}

function hideHistory(): void {
  historyOpen.value = false;
  if (scrollEl.value) scrollEl.value.scrollTop = 0;
}

// §0.9: `[data-ade-day="<k>"]` is the same numeric offset `timelineOps.ts`'s `DropTarget` already
// matches bands on (`LATER` for the Later band) — one attribute serves both scroll targeting and
// drop-target resolution (commit 10). `getBoundingClientRect` rather than `offsetTop`: the band tree
// has no positioned ancestor of its own to make `offsetTop` reliable.
function scrollToDay(k: number): void {
  const el = scrollEl.value;
  const target = el?.querySelector(`[data-ade-day="${k}"]`) as HTMLElement | null;
  if (!el || !target) return;
  const elRect = el.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  el.scrollTop += targetRect.top - elRect.top - headerHeight.value - 2;
}

function goCurrentWork(): void {
  if (view.value) scrollToDay(view.value.focusDay);
}

// §0.9: a future date beyond the horizon (either "or date" or the History bar's "Go to") persists
// as a settings override; a date already inside the horizon just scrolls.
async function extendHorizon(iso: string): Promise<void> {
  const ade = settingsStore.ade;
  if (!ade.extraDays.includes(iso)) {
    await settingsStore.patchSettings({ ade: { extraDays: [...ade.extraDays, iso] } });
  }
  await nextTick();
  scrollToDay(isoToOffset(today.value, iso));
}

function onMoreWeek(): void {
  const ade = settingsStore.ade;
  void settingsStore.patchSettings({ ade: { horizonDays: Math.min(365, ade.horizonDays + 7) } });
}

// §0.9: `AdeDayControls`' own "or date" input is future-only (`min` = tomorrow) — a same-day/past
// value is still reachable by typing, so it's ignored here rather than corrupting `extraDays`.
async function onPickDate(iso: string): Promise<void> {
  if (isoToOffset(today.value, iso) > 0) await extendHorizon(iso);
}

// §0.9: the History bar's own "Go to" field does double duty — a past date grows `historyReach`
// (runtime only, never written to settings, §0.9); a future date short of the horizon just scrolls;
// beyond it, same `extraDays` path as `onPickDate`.
async function onGoToDate(iso: string): Promise<void> {
  const k = isoToOffset(today.value, iso);
  if (k < 0) {
    historyReach.value = Math.max(historyReach.value ?? settingsStore.ade.historyDays, -k + 2);
    await nextTick();
    scrollToDay(k);
    return;
  }
  if (k < settingsStore.ade.horizonDays) {
    await nextTick();
    scrollToDay(k);
    return;
  }
  await extendHorizon(iso);
}

const minExtraDate = computed(() => offsetToIso(today.value, 1));

// §0.9: `inHistory` — open, and scrolled far enough that today's own band has passed under the
// sticky header (mockup's own `scrollTop + headerHeight < todayBand.offsetTop - 30`). `offsetTop`
// itself would need a positioned ancestor this tree doesn't have, so it's rebuilt from the current
// `getBoundingClientRect` plus the live `scrollTop` — stable across scroll since both move together.
const inHistory = computed(() => {
  if (!historyOpen.value) return false;
  const el = scrollEl.value;
  const todayBand = el?.querySelector('[data-ade-day="0"]') as HTMLElement | null;
  if (!el || !todayBand) return false;
  const elRect = el.getBoundingClientRect();
  const todayTop = todayBand.getBoundingClientRect().top - elRect.top + el.scrollTop;
  return scrollY.value + headerHeight.value < todayTop - 30;
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
    localDayOf: localIsoOfMs,
    rebasing: adeActionsStore.rebasingFor(props.codeRepoId),
    // §0.6: outlives a repo-tab remount (stored in `adeUi`, not a local ref) — `useQueue`'s own
    // first-item default applies once the entry is unset or names a since-removed item.
    selectedId: adeUiStore.selectedByRepo[props.codeRepoId],
    historyOpen: historyOpen.value,
    historyReach: historyReach.value,
  });
});

function onSelect(id: string): void {
  adeUiStore.select(props.codeRepoId, id);
}

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
  <div ref="scrollEl" class="flex min-h-0 flex-1 flex-col overflow-auto" data-testid="ade-repo-view">
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
      <div ref="headerEl" class="sticky top-0 z-10 bg-bg pt-2.5">
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
        <AdeHistoryBar
          v-if="inHistory"
          @go-to-date="onGoToDate"
          @hide="hideHistory"
          @current="goCurrentWork"
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
      <AdeTimeline
        v-if="view"
        :view="view"
        :history-open="historyOpen"
        :pull="pull"
        :pct="pct"
        :history-days="settingsStore.ade.historyDays"
        :min-extra-date="minExtraDate"
        @select="onSelect"
        @open-history="() => void openHistory()"
        @more-week="onMoreWeek"
        @pick-date="onPickDate"
      />
    </template>
    <AdeClaudeDialog :code-repo-id="codeRepoId" :ctx="dialogCtx" />
  </div>
</template>
