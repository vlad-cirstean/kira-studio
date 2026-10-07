<script setup lang="ts">
import { Alert, AlertDescription, AlertTitle } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { useElementSize, useScroll } from '@vueuse/core';
import { type MenuItem, useContextMenuStore } from '@workbench/state/contextMenu';
import { computed, nextTick, ref } from 'vue';
import { useSettingsStore } from '../../../state/settings';
import AdeConfirmDialog from '../AdeConfirmDialog.vue';
import AdeForcePushDialog from '../AdeForcePushDialog.vue';
import { dayLabel, firstWork, isoToOffset, nextWork, offsetToIso } from '../board/calendar';
import { dayMenuFor } from '../board/dayMenu';
import { dropVerdict, shiftPlanArgs } from '../board/dropPlan';
import { refreshNote, remoteErrorText } from '../board/panelFacts';
import type { TimelineBand } from '../board/timeline';
import { useRefresh, useSetPlan } from '../queries';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import AdeDayBand from './AdeDayBand.vue';
import AdeDayControls from './AdeDayControls.vue';
import AdeHistoryBar from './AdeHistoryBar.vue';
import AdePlanHeader, { type RepoChipModel } from './AdePlanHeader.vue';
import { usePlanDrag } from './usePlanDrag';
import type { BranchRowModel } from './usePlanModel';
import { usePlanModel } from './usePlanModel';

const ui = useAdeBoardUiStore();
const settingsStore = useSettingsStore();
const contextMenu = useContextMenuStore();
const { model, today, repoLabel, settings, boardQuery } = usePlanModel();
const setPlan = useSetPlan();
const refresh = useRefresh();

const scrollEl = ref<HTMLElement | null>(null);
const headerEl = ref<HTMLElement | null>(null);
const { height: headerHeight } = useElementSize(headerEl);
const { y: scrollY } = useScroll(scrollEl);

// ---- refresh
const busyIds = ref<string[]>([]);
const allBusy = ref(false);
const refreshErrors = ref<Record<string, string>>({});

async function runRefresh(codeRepoIds: string[], all: boolean): Promise<void> {
  const ids = all ? (model.value?.board.repos.map((r) => r.codeRepoId) ?? []) : codeRepoIds;
  busyIds.value = [...busyIds.value, ...ids];
  allBusy.value = allBusy.value || all;
  const errs = { ...refreshErrors.value };
  for (const id of ids) delete errs[id];
  try {
    const res = await refresh.mutateAsync({ codeRepoIds: ids });
    const summaries = { ...ui.refreshSummary };
    for (const r of res.repos) {
      if (r.error) errs[r.codeRepoId] = remoteErrorText(r.error);
      else summaries[r.codeRepoId] = refreshNote(r);
    }
    ui.refreshSummary = summaries;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    for (const id of ids) errs[id] = msg;
  } finally {
    refreshErrors.value = errs;
    busyIds.value = busyIds.value.filter((id) => !ids.includes(id));
    if (all) allBusy.value = false;
  }
}

const chips = computed<RepoChipModel[]>(() =>
  (model.value?.board.repos ?? []).map((r) => ({
    codeRepoId: r.codeRepoId,
    label: repoLabel(r.codeRepoId),
    lastFetchAt: r.lastFetchAt,
    shown: !ui.hiddenRepoIds.includes(r.codeRepoId),
    busy: busyIds.value.includes(r.codeRepoId),
    error: refreshErrors.value[r.codeRepoId] ?? '',
    summary: ui.refreshSummary[r.codeRepoId] ?? '',
  })),
);

// ---- bands
function bandCards(band: TimelineBand) {
  const cards = model.value?.cards;
  return band.taskIds.flatMap((id) => cards?.get(id) ?? []);
}

function bandSpans(band: TimelineBand) {
  const m = model.value;
  if (!m) return [];
  return band.spans.flatMap((s) => {
    const card = m.cards.get(s.taskId);
    if (!card) return [];
    return {
      taskId: s.taskId,
      title: card.title,
      color: card.color,
      note: `day ${s.dayNumber}/${s.dayCount}${s.merges ? ' · merges' : ''}`,
      merges: s.merges,
      tip: `continues from ${dayLabel(m.cal, s.startDay)}; click to open`,
    };
  });
}

function bandHistory(band: TimelineBand) {
  return band.history.map((h) => ({
    key: h.taskId,
    how: h.mergedAt ? 'merged · archived' : 'archived',
    repos: h.codeRepoIds.map(repoLabel).join(' · '),
    title: h.title,
  }));
}

function overdueNote(band: TimelineBand): string {
  const n = band.overdueTaskIds.length;
  return `${n} ${n === 1 ? 'task' : 'tasks'} not merged`;
}

function overflowNote(band: TimelineBand): string {
  return `${band.overflowHours}h over ${settings.value.workdayHours}h`;
}

function overflowLabel(band: TimelineBand): string {
  const m = model.value;
  if (!m) return '';
  const ids = band.overflowTaskIds;
  const what = ids.length === 1 ? (m.cards.get(ids[0] as string)?.title ?? '') : `${ids.length} tasks`;
  return `Move to ${dayLabel(m.cal, band.overflowMoveTo)} · ${what}`;
}

// ---- plan writes
async function shift(ids: readonly string[], toDay: number): Promise<void> {
  const m = model.value;
  if (!m) return;
  await setPlan.mutateAsync(shiftPlanArgs(m.board.plan, today.value, ids, toDay)).catch(() => {
    /* surfaced through setPlan.error */
  });
}

function onRollover(band: TimelineBand): void {
  const m = model.value;
  if (m) void shift(band.overdueTaskIds, firstWork(m.cal, 0));
}

function onOverflowMove(band: TimelineBand): void {
  void shift(band.overflowTaskIds, band.overflowMoveTo);
}

const drag = usePlanDrag((taskId, target) => {
  const m = model.value;
  if (!m) return;
  const verdict = dropVerdict(m.view, m.board.plan, today.value, taskId, target);
  if (verdict.kind === 'move') setPlan.mutate(verdict.args);
});
const dragOverDay = computed(() =>
  drag.draggedId.value && drag.target.value?.kind === 'band' ? drag.target.value.day : null,
);

// ---- day menu
const dayOff = ref<{ title: string; text: string; yes: string; ids: string[]; to: number } | null>(null);

function startIdsOf(band: TimelineBand): string[] {
  const entries = model.value?.view.entries;
  return band.taskIds.filter((id) => entries?.get(id)?.kind === 'task');
}

function onDayMenu(band: TimelineBand, ev: MouseEvent): void {
  const m = model.value;
  if (!m) return;
  const starts = startIdsOf(band);
  const menu = dayMenuFor(m.cal, settings.value, today.value, band.key, starts.length);
  if (!menu) return;
  const items: MenuItem[] = [
    { type: 'label', label: band.label },
    {
      type: 'item',
      id: 'ade-day-toggle',
      label: menu.label,
      run: async () => {
        await settingsStore.patchSettings({ ade: menu.patch });
        if (!menu.confirm) return;
        const to = nextWork(m.cal, band.key);
        const n = starts.length;
        const toLabel = dayLabel(m.cal, to);
        dayOff.value = {
          title: `${band.label} is a day off`,
          text: `Move ${n} ${n === 1 ? 'task' : 'tasks'} planned for that day to ${toLabel}?`,
          yes: `Move to ${toLabel}`,
          ids: starts,
          to,
        };
      },
    },
  ];
  contextMenu.openContextMenu(ev, items);
}

async function runDayOff(): Promise<string | null> {
  const d = dayOff.value;
  const m = model.value;
  if (!d || !m) return null;
  await setPlan.mutateAsync(shiftPlanArgs(m.board.plan, today.value, d.ids, d.to));
  return null;
}

// ---- scroll and horizon
function scrollToDay(k: number): void {
  const el = scrollEl.value;
  const target = el?.querySelector<HTMLElement>(`[data-ade-day="${k}"]`);
  if (!el || !target) return;
  el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - headerHeight.value - 2;
}

async function openHistory(): Promise<void> {
  const el = scrollEl.value;
  if (!el) return;
  const before = el.scrollHeight;
  ui.showHistory = true;
  await nextTick();
  el.scrollTop = el.scrollHeight - before - 60;
}

function hideHistory(): void {
  ui.showHistory = false;
  ui.historyReach = null;
  if (scrollEl.value) scrollEl.value.scrollTop = 0;
}

const inHistory = computed(() => {
  if (!ui.showHistory) return false;
  const el = scrollEl.value;
  const todayBand = el?.querySelector<HTMLElement>('[data-ade-day="0"]');
  if (!el || !todayBand) return false;
  const todayTop = todayBand.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
  return scrollY.value + headerHeight.value < todayTop - 30;
});

async function extendHorizon(iso: string): Promise<void> {
  const ade = settingsStore.ade;
  if (!ade.extraDays.includes(iso)) {
    const kept = ade.extraDays.filter((d) => d >= today.value);
    await settingsStore.patchSettings({ ade: { extraDays: [...kept, iso] } });
  }
  await nextTick();
  scrollToDay(isoToOffset(today.value, iso));
}

function onMoreWeek(): void {
  void settingsStore.patchSettings({
    ade: { horizonDays: Math.min(365, settingsStore.ade.horizonDays + 7) },
  });
}

async function onPickDate(iso: string): Promise<void> {
  if (isoToOffset(today.value, iso) > 0) await extendHorizon(iso);
}

async function onGoToDate(iso: string): Promise<void> {
  const k = isoToOffset(today.value, iso);
  if (k < 0) {
    ui.historyReach = Math.max(ui.historyReach ?? settingsStore.ade.historyDays, -k + 2);
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
const forcePushTarget = ref<{ branchId: string; branchName: string; repo: string } | null>(null);

function onForcePush(row: BranchRowModel): void {
  forcePushTarget.value = { branchId: row.id, branchName: row.name, repo: row.repo };
}
</script>

<template>
  <div ref="scrollEl" class="relative min-h-0 min-w-0 flex-1 overflow-auto rounded-kira border border-border bg-bg px-5 pb-5" data-testid="ade-plan">
    <Alert v-if="boardQuery.isError.value" variant="destructive" class="my-4" data-testid="ade-board-error">
      <AlertTitle>Couldn't load the board</AlertTitle>
      <AlertDescription>{{ (boardQuery.error.value as Error | null)?.message }}</AlertDescription>
      <Button variant="dialog" size="sm" class="mt-2" @click="() => boardQuery.refetch()">Retry</Button>
    </Alert>
    <p v-else-if="!model" class="p-4 text-muted-foreground" data-testid="ade-plan-loading">Loading…</p>
    <template v-else>
      <div ref="headerEl" class="sticky top-0 z-10 bg-bg pt-2.5">
        <AdePlanHeader
          :repos="chips"
          :all-busy="allBusy"
          :ripple="model.ripple"
          @refresh-all="runRefresh([], true)"
          @refresh-one="(id) => runRefresh([id], false)"
          @toggle="(id) => ui.toggleRepo(id)"
        />
        <AdeHistoryBar v-if="inHistory" @go-to-date="onGoToDate" @hide="hideHistory" @current="scrollToDay(0)" />
      </div>
      <Alert v-if="setPlan.isError.value" variant="destructive" class="my-2" data-testid="ade-plan-error">
        <AlertDescription class="flex items-center gap-2">
          <span class="flex-1">{{ (setPlan.error.value as Error | null)?.message }}</span>
          <Button variant="link" size="sm" @click="setPlan.reset()">Dismiss</Button>
        </AlertDescription>
      </Alert>
      <button
        v-if="!ui.showHistory"
        type="button"
        class="mb-2.5 ml-15 mt-0.5 flex h-7 w-[calc(100%-60px)] items-center justify-center gap-2 rounded-kira border border-dashed border-border-strong bg-transparent text-kira-sm text-muted-foreground"
        data-testid="ade-load-history"
        @click="openHistory"
      >
        <span>↑</span>
        <span class="font-semibold text-fg">{{ model.view.historyButtonLabel }}</span>
      </button>
      <template v-for="band in model.view.bands" :key="band.key">
        <AdeDayControls v-if="band.isLater" :min-date="minExtraDate" @more-week="onMoreWeek" @pick-date="onPickDate" />
        <AdeDayBand
          :band="band"
          :cards="bandCards(band)"
          :spans="bandSpans(band)"
          :history="bandHistory(band)"
          :overdue-note="overdueNote(band)"
          :overflow-note="overflowNote(band)"
          :overflow-label="overflowLabel(band)"
          :drag-over="dragOverDay === band.key"
          @select="(id) => ui.select(id)"
          @rollover="onRollover(band)"
          @overflow-move="onOverflowMove(band)"
          @day-menu="(ev) => onDayMenu(band, ev)"
          @force-push="onForcePush"
          @drag-start="drag.begin"
          @drag-end="drag.end"
        />
      </template>
      <button
        v-if="model.view.hiddenCount > 0"
        type="button"
        class="ml-15 mt-2.5 flex h-8 w-[calc(100%-60px)] items-center justify-center gap-2 rounded-kira border border-dashed border-border-strong bg-transparent text-kira-md font-semibold text-fg"
        data-testid="ade-load-all"
        @click="ui.showAllItems = true"
      >
        ↓ {{ model.view.moreButtonLabel }}
      </button>
      <button
        v-if="model.view.canCollapse"
        type="button"
        class="ml-15 mt-2.5 block h-control-lg rounded-kira border-0 bg-transparent px-2.5 text-kira-sm text-muted-foreground"
        data-testid="ade-collapse"
        @click="ui.showAllItems = false"
      >
        Show only the first 10 again
      </button>
    </template>
    <AdeConfirmDialog
      :open="dayOff !== null"
      :title="dayOff?.title ?? ''"
      :text="dayOff?.text ?? ''"
      :yes-label="dayOff?.yes ?? ''"
      no-label="Leave it"
      :run="runDayOff"
      @close="dayOff = null"
    />
    <AdeForcePushDialog :target="forcePushTarget" @close="forcePushTarget = null" />
  </div>
</template>
