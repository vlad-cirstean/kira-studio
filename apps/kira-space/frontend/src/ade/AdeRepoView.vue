<script setup lang="ts">
import { Alert, AlertDescription, AlertTitle } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { useElementSize, useIntervalFn, useScroll } from '@vueuse/core';
import { type MenuItem, useContextMenuStore } from '@workbench/state/contextMenu';
import { computed, nextTick, ref } from 'vue';
import { useCodeReposStore } from '../state/coderepos';
import { useSettingsStore } from '../state/settings';
import AdeAddPopover from './AdeAddPopover.vue';
import AdeClaudeDialog from './AdeClaudeDialog.vue';
import AdeConfirmDialog from './AdeConfirmDialog.vue';
import AdeDetailPanel from './AdeDetailPanel.vue';
import AdeHistoryBar from './AdeHistoryBar.vue';
import AdeMainLine from './AdeMainLine.vue';
import AdePanelResizeHandle from './AdePanelResizeHandle.vue';
import AdeProjectHeader from './AdeProjectHeader.vue';
import AdeTimeline from './AdeTimeline.vue';
import { type DialogCtx, moveSpec, rebaseAllSpec, specForQueueAction, startSpec } from './dialogCompose';
import { localIso, localIsoOfMs } from './localDay';
import { useAdePrs, useAdeSessions, useAdeSnapshot } from './queries';
import { useAdeActionsStore } from './state/adeActions';
import { useAdeUiStore } from './state/adeUi';
import { useAgentSessionsStore } from './state/agentSessions';
import {
  type DayMenuResult,
  dayMenuFor,
  movePlanArgs,
  type SetPlanArgs,
  shiftWorkArgs,
} from './timelineOps';
import { useHistoryPull } from './useHistoryPull';
import {
  isoToOffset,
  LATER,
  offsetToIso,
  type QueueBand,
  type QueueSegment,
  useQueue,
} from './useQueue';

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
const contextMenuStore = useContextMenuStore();

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

// §0.13: overdue's own "Move to today" — `shiftWorkArgs` against `view.firstWorkDay`, no dialog
// (design §2.3, mockup `rollover`).
async function onRollover(band: QueueBand): Promise<void> {
  const snapshot = snapshotQuery.data.value;
  const queueView = view.value;
  if (!snapshot || !queueView) return;
  const args = shiftWorkArgs(snapshot.plan, today.value, band.overdueIds, queueView.firstWorkDay);
  await adeActionsStore.applyPlan(props.codeRepoId, args);
}

// §0.13: overflow's own "Move to …" — `shiftWorkArgs` against the band's own `overflowMoveDay`, no
// dialog (mockup `overflowMove`).
async function onOverflowMove(band: QueueBand): Promise<void> {
  const snapshot = snapshotQuery.data.value;
  if (!snapshot || band.overflowMoveDay === null) return;
  const args = shiftWorkArgs(snapshot.plan, today.value, band.overflowIds, band.overflowMoveDay);
  await adeActionsStore.applyPlan(props.codeRepoId, args);
}

// §0.10: the day context menu — `dayMenuFor` returns `null` on Later and past days (menu doesn't
// open at all), off > weekend > weekday precedence otherwise. The title row is the workbench's new
// `label` `MenuItem` variant (§0.10).
function onDayMenu(band: QueueBand, ev: MouseEvent): void {
  const menu = dayMenuFor(band, settingsStore.ade);
  if (!menu) return;
  const items: MenuItem[] = [
    { type: 'label', label: band.longLabel },
    { type: 'item', id: 'ade-day-toggle', label: menu.label, run: () => onDayMenuToggle(band, menu) },
  ];
  contextMenuStore.openContextMenu(ev, items);
}

async function onDayMenuToggle(band: QueueBand, menu: DayMenuResult): Promise<void> {
  await settingsStore.patchSettings({ ade: menu.patch });
  if (menu.confirmAfter) openDayOffConfirm(band);
}

// §0.11: marking a worked weekday off, with stacks already starting there, offers to move them —
// `to` is `band.nextWorkDay` (`nextWork` already skips days off/unworked weekends, so it can't be
// `null` here: `dayMenuFor` only sets `confirmAfter` for a still-in-range weekday).
function openDayOffConfirm(band: QueueBand): void {
  const to = band.nextWorkDay;
  if (to === null) return;
  const count = band.startIds.length;
  adeUiStore.openConfirm({
    title: `${band.longLabel} is a day off`,
    text: `Move ${count} ${count === 1 ? 'branch' : 'branches'} planned for that day to ${band.nextWorkLong}?`,
    yesLabel: `Move to ${band.nextWorkLabel}`,
    noLabel: 'Leave it',
    token: null,
    run: async () => {
      const snapshot = snapshotQuery.data.value;
      if (!snapshot) return;
      const args = shiftWorkArgs(snapshot.plan, today.value, band.startIds, to);
      await adeActionsStore.applyPlan(props.codeRepoId, args);
    },
  });
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
    pushing: adeActionsStore.pushingFor(props.codeRepoId),
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

// §0.21: the activity icon's own hand-off, bubbled from `AdeAgentsPill`.
function onOpenSession(itemId: string, sessionId: string): void {
  adeUiStore.openSession(props.codeRepoId, itemId, sessionId);
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

// P129 Part 6 §0.2/§0.3: the flex-row layout root — `rootEl`'s own live width feeds the panel's
// "0 means half" default and its resize clamp. `itemsById` mirrors `AdeTimeline.vue`'s own lookup
// (the Changes tab resolves conflict/shared partner ids to branch names, §2.3).
const rootEl = ref<HTMLElement | null>(null);
const { width: rootWidth } = useElementSize(rootEl);
const itemsById = computed(() => new Map((view.value?.items ?? []).map((item) => [item.id, item])));

const PANEL_MIN = 340;
const panelMax = computed(() => Math.max(PANEL_MIN, rootWidth.value - PANEL_MIN));

function clampPanelWidth(w: number): number {
  return Math.max(PANEL_MIN, Math.min(panelMax.value, w));
}

/** Settings-resolved width — `0` means half the root's own width (§0.2's "default half width"). */
const settledPanelWidth = computed(() => {
  const stored = settingsStore.ade.panelWidth;
  return clampPanelWidth(stored === 0 ? rootWidth.value / 2 : stored);
});

// Live override while dragging or repeating an arrow key — `null` once nothing overrides it, falling
// back to the settings-resolved width above.
const dragPanelWidth = ref<number | null>(null);
const panelWidth = computed(() => dragPanelWidth.value ?? settledPanelWidth.value);

function onPanelResize(w: number): void {
  dragPanelWidth.value = w;
}

function onPanelCommit(w: number): void {
  void settingsStore.patchSettings({ ade: { panelWidth: Math.round(clampPanelWidth(w)) } });
  dragPanelWidth.value = null;
}

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

// §0.17/§0.16: the action column's own two events — `rebase`/`queueAfter` open the Move dialog,
// `forcePush` calls `adeActions.forcePush` directly (no dialog, mockup `forcePush`).
function onSegmentAction(action: NonNullable<QueueSegment['action']>): void {
  if (action.kind === 'forcePush') {
    void adeActionsStore.forcePush(props.codeRepoId, action.targetIds);
    return;
  }
  const ctx = dialogCtx.value;
  if (!ctx) return;
  // `action` itself stays typed `QueueAction` after the guard above (a single interface with a
  // union-typed `kind`, not a discriminated union of interfaces) — TS only narrows a direct
  // `action.kind` read, so `specForQueueAction` takes the two fields it needs rather than the whole
  // object.
  adeUiStore.openDialog(specForQueueAction(ctx, { kind: action.kind, targetIds: action.targetIds }));
}

// §0.17/§0.16: `start` opens the launch dialog; `archive` (nothing at risk) archives directly —
// `dialogFlow.ts`'s own `requestArchive` opens Part 4's archive-risk dialog itself when needed.
function onCellAction(action: NonNullable<QueueSegment['cells'][number]['action']>): void {
  const ctx = dialogCtx.value;
  if (!ctx) return;
  if (action.kind === 'start') {
    adeUiStore.openDialog(startSpec(ctx, action.id));
  } else {
    void adeActionsStore.requestArchive(props.codeRepoId, action.id, ctx);
  }
}

// §0.12/§2.7: `AdeTimeline`'s own two drop outcomes — `dropVerdict` itself already ran there
// (§2.7's "one place"), so this is a straight-through write, or the Move dialog with its own
// `applyPlan` closure (§0.14: the dialog writes the plan before it delivers).
function onApplyPlan(args: SetPlanArgs): void {
  void adeActionsStore.applyPlan(props.codeRepoId, args);
}

function onOpenMoveDialog(args: { ids: string[]; before: string | null; day: number }): void {
  const ctx = dialogCtx.value;
  const snapshot = snapshotQuery.data.value;
  if (!ctx || !snapshot) return;
  const iso = args.day === LATER ? null : offsetToIso(today.value, args.day);
  adeUiStore.openDialog(
    moveSpec(ctx, args.ids, args.before, iso, () =>
      adeActionsStore.applyPlan(
        props.codeRepoId,
        movePlanArgs(snapshot.plan, today.value, args.ids, args.before, args.day),
      ),
    ),
  );
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
  <div ref="rootEl" class="flex min-h-0 flex-1">
  <div ref="scrollEl" class="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto" data-testid="ade-repo-view">
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
        >
          <AdeAddPopover :code-repo-id="codeRepoId" :items="view?.items ?? []" />
        </AdeMainLine>
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
        v-if="view && snapshotQuery.data.value"
        :view="view"
        :plan="snapshotQuery.data.value.plan"
        :today="today"
        :history-open="historyOpen"
        :pull="pull"
        :pct="pct"
        :history-days="settingsStore.ade.historyDays"
        :min-extra-date="minExtraDate"
        @select="onSelect"
        @open-session="onOpenSession"
        @open-history="() => void openHistory()"
        @more-week="onMoreWeek"
        @pick-date="onPickDate"
        @rollover="onRollover"
        @overflow-move="onOverflowMove"
        @day-menu="onDayMenu"
        @segment-action="onSegmentAction"
        @cell-action="onCellAction"
        @apply-plan="onApplyPlan"
        @open-move-dialog="onOpenMoveDialog"
      />
    </template>
    <AdeClaudeDialog :code-repo-id="codeRepoId" :ctx="dialogCtx" />
    <AdeConfirmDialog />
  </div>
  <template v-if="view?.panel">
    <AdePanelResizeHandle
      :value="panelWidth"
      :min="PANEL_MIN"
      :max="panelMax"
      @resize="onPanelResize"
      @commit="onPanelCommit"
    />
    <AdeDetailPanel
      :panel="view.panel"
      :dialog-ctx="dialogCtx"
      :code-repo-id="codeRepoId"
      :items-by-id="itemsById"
      :prs="prsQuery.data.value"
      :width="panelWidth"
    />
  </template>
  </div>
</template>
