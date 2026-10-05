import { createSharedComposable, useIntervalFn } from '@vueuse/core';
import { computed, ref, watch } from 'vue';
import { useCodeReposStore } from '../../../state/coderepos';
import { useSettingsStore } from '../../../state/settings';
import { useAgentSessionsStore } from '../../state/agentSessions';
import { withTuiActivity } from '../activity';
import { type BranchTag, branchTag, type TaskAction, taskCell } from '../board/actions';
import { type BaseMarker, baseMarker } from '../board/baseMarker';
import { isDraft } from '../board/branchGraph';
import { buildCalendar, type Calendar, dayLabel } from '../board/calendar';
import { type BranchLine2, branchLine2, taskTitle } from '../board/labels';
import { buildNeedsYou, type NeedsItem, type NeedsKind } from '../board/needsYou';
import {
  type BranchProgress,
  type BranchSegState,
  branchProgress,
  buildTaskProgress,
  type TaskProgress,
} from '../board/progress';
import { buildStageBlocks, type StageBlock } from '../board/stageBlocks';
import { type DerivedStatus, deriveStatus } from '../board/status';
import {
  buildTimeline,
  type Ripple,
  rippleOf,
  type TimelineEntry,
  type TimelineView,
} from '../board/timeline';
import { localIso, localIsoOfMs } from '../localDay';
import { taskColor } from '../palette';
import { useBoard, usePrs, useRepos, useSessions, useWorkflows } from '../queries';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import type { Board, Branch, Session, Task, Workflow } from '../wire';

/** Needs-you kinds that put a `!` on a card and row: a waiting question, a stuck run. */
const ASKS: ReadonlySet<NeedsKind> = new Set(['question', 'stuck run']);

export interface BranchRowModel {
  id: string;
  depth: number;
  branch: Branch;
  repo: string;
  base: BaseMarker | null;
  draft: boolean;
  /** Branch name, `new branch` until created. */
  name: string;
  isReview: boolean;
  /** Second line: `no branch yet · from main`, or a review item's PR title. */
  context: string;
  tag: BranchTag;
  /** Own progress line while the task is in an agent or script stage. */
  prog: { segs: BranchSegState[]; label: string; tone: BranchProgress['tone']; tip: string } | null;
  ripple: boolean;
  /** Merged-into and deployed chips of the second line, nothing for a branch not in any target. */
  chips: Pick<BranchLine2, 'merged' | 'deployed' | 'divider'>;
  /** Tooltip of the `!` circle; `''` when the branch needs nothing from the user. */
  attention: string;
  /** What a click on the `!` does. */
  attentionItem: NeedsItem | null;
}

export interface CardModel {
  task: Task;
  entry: TimelineEntry;
  color: string;
  title: string;
  /** Title with no custom name set: the Name field placeholder. */
  defaultTitle: string;
  progress: TaskProgress;
  /** The task's workflow file, `null` when it has none or the file is gone. */
  workflow: Workflow | null;
  /** Panel Workflow block: one per stage; empty for a review or parked task. */
  blocks: StageBlock[];
  status: DerivedStatus;
  tag: { label: string; tone: BranchTag['tone']; tip: string; since?: number } | null;
  /** Task stage action; which kinds render is `useTaskAction`'s call. */
  action: TaskAction | null;
  /** `3d → Mon 28 · PAY-102 · api · web-app`. */
  meta: string;
  attention: string;
  attentionItem: NeedsItem | null;
  rows: BranchRowModel[];
  review: boolean;
  parked: boolean;
  allMerged: boolean;
  selected: boolean;
  ripple: boolean;
}

type NeedsYou = ReturnType<typeof buildNeedsYou>;

interface Ctx {
  board: Board;
  view: TimelineView;
  cal: Calendar;
  progress: ReadonlyMap<string, TaskProgress>;
  sessions: readonly Session[];
  workflows: ReadonlyMap<string, Workflow>;
  needs: NeedsYou;
  ripple: Ripple | null;
  selectedId: string | null;
  mainName: ReadonlyMap<string, string>;
  prTitle: (branchId: string) => string;
  repoLabel: (codeRepoId: string) => string;
  nowMs: number;
}

function buildRow(c: Ctx, task: Task, bid: string, depth: number): BranchRowModel {
  const graph = c.view.graph;
  const br = graph.byBranch.get(bid) as Branch;
  const draft = isDraft(br);
  const parent = graph.parentOf.get(bid);
  const parentName = parent === undefined ? undefined : graph.byBranch.get(parent)?.name;
  const attn = c.needs.items.find((n) => ASKS.has(n.kind) && n.branchId === bid);
  const main = c.mainName.get(br.codeRepoId) ?? '';
  const taskProgress = c.progress.get(task.id);
  const prog = taskProgress ? branchProgress(taskProgress, bid) : null;
  const line2 = branchLine2(br, graph, c.prTitle(bid));
  let context = '';
  if (draft) context = `no branch yet · from ${parentName || br.base || 'main'}`;
  else if (br.kind === 'review') context = c.prTitle(bid);
  return {
    id: bid,
    depth: task.kind === 'review' ? 0 : depth + 1,
    branch: br,
    repo: c.repoLabel(br.codeRepoId),
    base: baseMarker(br, graph, main),
    draft,
    name: draft ? 'new branch' : br.name,
    isReview: br.kind === 'review',
    context,
    tag: branchTag({
      branch: br,
      graph,
      plan: c.board.plan,
      after: c.view.after,
      nowMs: c.nowMs,
      hadSession: c.sessions.some((x) => x.branchId === bid),
      mainName: main,
    }),
    prog: prog ? { segs: prog.segments, label: prog.label, tone: prog.tone, tip: prog.tip } : null,
    ripple: c.ripple?.branchIds.includes(bid) ?? false,
    chips: { merged: line2.merged, deployed: line2.deployed, divider: line2.divider },
    attention: attn?.what ?? '',
    attentionItem: attn ?? null,
  };
}

function cardMeta(c: Ctx, entry: TimelineEntry, task: Task, branches: Branch[]): string {
  const repoNames: string[] = [];
  for (const br of branches) {
    const label = c.repoLabel(br.codeRepoId);
    if (!repoNames.includes(label)) repoNames.push(label);
  }
  const jira = task.jira?.key;
  return (
    (entry.days.length > 1 ? `${entry.span}d → ${dayLabel(c.cal, entry.end)} · ` : '') +
    (jira ? `${jira} · ` : '') +
    repoNames.join(' · ')
  );
}

function buildCard(c: Ctx, id: string): CardModel | null {
  const graph = c.view.graph;
  const entry = c.view.entries.get(id);
  const task = graph.byTask.get(id);
  if (!entry || !task) return null;
  const progress = c.progress.get(id) as TaskProgress;
  const branches = task.branchIds.flatMap((bid) => graph.byBranch.get(bid) ?? []);
  const sessions = c.sessions.filter((x) => x.taskId === id);
  const status = deriveStatus({ task, progress, branches, hasSessions: sessions.length > 0 });
  const cell = taskCell({ task, progress, status, branches, sessions });
  const workflow = c.workflows.get(task.workflowId) ?? null;
  const hidden = task.kind !== 'task';
  const first = branches[0];
  const mine = branches.filter((br) => br.kind === 'mine');
  const needsOf = c.needs.items.find((n) => ASKS.has(n.kind) && n.taskId === id);
  return {
    task,
    entry,
    color: taskColor(task.color),
    title: taskTitle(task, first, first ? c.prTitle(first.id) : ''),
    defaultTitle: taskTitle({ ...task, title: '' }, first, first ? c.prTitle(first.id) : ''),
    progress,
    workflow,
    blocks: hidden
      ? []
      : buildStageBlocks(
          {
            task,
            workflow,
            branch: (bid) => graph.byBranch.get(bid),
            repoNick: c.repoLabel,
          },
          workflow,
          progress.stage,
          progress.stageIndex,
          progress.finished,
        ),
    status,
    tag: cell?.tag ?? null,
    action: cell?.action ?? null,
    meta: cardMeta(c, entry, task, branches),
    attention: needsOf?.what ?? '',
    attentionItem: needsOf ?? null,
    rows: c.view.branchRows(id).map(({ id: bid, depth }) => buildRow(c, task, bid, depth)),
    review: task.kind === 'review',
    parked: task.kind === 'parked',
    allMerged: mine.length > 0 && mine.every((br) => br.mergedIntoMain),
    selected: c.selectedId === id,
    ripple: c.ripple?.taskIds.includes(id) ?? false,
  };
}

function buildPlanModel() {
  const board = useBoard();
  const prs = usePrs();
  const sessionsQuery = useSessions();
  const agentStore = useAgentSessionsStore();
  const workflows = useWorkflows();
  const repos = useRepos();
  const settingsStore = useSettingsStore();
  const codeReposStore = useCodeReposStore();
  const ui = useAdeBoardUiStore();

  // The model reads the minute clock; `liveNow` also ticks per second while a setup runs, for the
  // `⚙ preparing 3m 40s` label alone, so a running setup never rebuilds the whole model.
  const now = ref(new Date());
  const liveNow = ref(now.value);
  useIntervalFn(() => {
    now.value = new Date();
    liveNow.value = now.value;
  }, 60_000);
  const setupRunning = computed(
    () => board.data.value?.branches.some((b) => b.setup?.state === 'running') ?? false,
  );
  const secondTick = useIntervalFn(
    () => {
      liveNow.value = new Date();
    },
    1000,
    { immediate: false },
  );
  watch(
    setupRunning,
    (running) => {
      if (running) secondTick.resume();
      else secondTick.pause();
    },
    { immediate: true },
  );
  const today = computed(() => localIso(now.value));
  /** Sessions with the TUI activity the server does not report, merged in from the agent hooks. */
  const sessions = computed(() =>
    withTuiActivity(sessionsQuery.data.value?.sessions ?? [], agentStore.activity),
  );

  function repoLabel(codeRepoId: string): string {
    const cfg = repos.data.value?.repos.find((r) => r.codeRepoId === codeRepoId);
    return (
      cfg?.nickname || cfg?.name || codeReposStore.codeRepoRecord(codeRepoId)?.name || codeRepoId
    );
  }

  const planSettings = computed(() => ({
    ...settingsStore.ade,
    historyDays: ui.historyReach ?? settingsStore.ade.historyDays,
  }));

  const model = computed(() => {
    const b = board.data.value;
    if (!b) return null;
    const view = buildTimeline({
      board: b,
      settings: planSettings.value,
      today: today.value,
      localDayOf: localIsoOfMs,
      repoLabel,
      showAllItems: ui.showAllItems,
      showHistory: ui.showHistory,
      hiddenRepoIds: new Set(ui.hiddenRepoIds),
    });
    const graph = view.graph;
    const wf = new Map<string, Workflow>();
    for (const e of workflows.data.value?.workflows ?? []) {
      if (e.workflow) wf.set(e.workflow.id, e.workflow);
    }
    const progress = new Map<string, TaskProgress>();
    for (const t of b.tasks) {
      progress.set(
        t.id,
        buildTaskProgress({
          task: t,
          workflow: wf.get(t.workflowId) ?? null,
          branch: (id) => graph.byBranch.get(id),
          repoNick: repoLabel,
        }),
      );
    }
    const nowMs = now.value.getTime();
    const selectedId = ui.selectedTaskId;
    const ctx: Ctx = {
      board: b,
      view,
      cal: buildCalendar(today.value, planSettings.value),
      progress,
      sessions: sessions.value,
      workflows: wf,
      needs: buildNeedsYou({
        board: b,
        sessions: sessions.value,
        progress,
        repoNick: repoLabel,
        nowMs,
      }),
      ripple: selectedId ? rippleOf(view, { kind: 'task', id: selectedId }) : null,
      selectedId,
      mainName: new Map(b.repos.map((r) => [r.codeRepoId, r.mainName])),
      prTitle: (id) => prs.data.value?.branches[id]?.title ?? '',
      repoLabel,
      nowMs,
    };
    const cards = new Map<string, CardModel>();
    for (const id of view.shownTaskIds) {
      const card = buildCard(ctx, id);
      if (card) cards.set(id, card);
    }
    // The panel opens tasks the Plan hides (first-10 cap, repo filter), so it builds them on demand.
    const cardFor = (id: string): CardModel | null => cards.get(id) ?? buildCard(ctx, id);
    return {
      board: b,
      view,
      cards,
      cardFor,
      ripple: ctx.ripple,
      cal: ctx.cal,
      needs: ctx.needs,
      workflows: wf,
    };
  });

  return {
    model,
    sessions,
    today,
    now,
    liveNow,
    repoLabel,
    settings: planSettings,
    boardQuery: board,
  };
}

/** Everything the Plan and the panel render, derived from the four cached queries and the view
 *  state. One instance serves every caller, so the panel never recomputes the Plan's model. */
export const usePlanModel = createSharedComposable(buildPlanModel);

export type PlanModel = NonNullable<ReturnType<typeof buildPlanModel>['model']['value']>;
