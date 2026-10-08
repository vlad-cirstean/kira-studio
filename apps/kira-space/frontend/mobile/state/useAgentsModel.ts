import { withTuiActivity } from '@ade/activity';
import { taskTitle } from '@ade/board/labels';
import { buildNeedsYou } from '@ade/board/needsYou';
import { buildTaskProgress, type TaskProgress } from '@ade/board/progress';
import { buildStageBlocks, type StageBlock } from '@ade/board/stageBlocks';
import { type DerivedStatus, deriveStatus } from '@ade/board/status';
import { localIso } from '@ade/localDay';
import { taskColor } from '@ade/palette';
import { useBoard, useRepoNames, useSessions, useWorkflows } from '@ade/readQueries';
import type { Branch, Task, Workflow } from '@ade/wire';
import { createSharedComposable, useIntervalFn } from '@vueuse/core';
import { computed, ref } from 'vue';
import { useAgentSessionsStore } from './agentSessions';

export interface PlanCard {
  task: Task;
  title: string;
  color: string;
  progress: TaskProgress;
  status: DerivedStatus;
  blocks: StageBlock[];
  /** Needs-you headline for this task, '' when none. */
  attention: string;
  /** Repo nicknames of the task's branches. */
  repos: string[];
}

export interface PlanGroup {
  key: string;
  label: string;
  cards: PlanCard[];
}

const DAY_MS = 86_400_000;

function dayLabel(iso: string, today: string): string {
  if (iso < today) return 'Earlier';
  if (iso === today) return 'Today';
  const date = new Date(`${iso}T00:00:00`);
  if (localIso(new Date(date.getTime() - DAY_MS)) === today) return 'Tomorrow';
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** The three tabs' data, derived from the cached read queries. One instance serves every screen. */
export const useAgentsModel = createSharedComposable(() => {
  const board = useBoard();
  const sessionsQuery = useSessions();
  const workflowsQuery = useWorkflows();
  const repoNames = useRepoNames();
  const agent = useAgentSessionsStore();

  const nowMs = ref(Date.now());
  useIntervalFn(() => {
    nowMs.value = Date.now();
  }, 60_000);

  const sessions = computed(() =>
    withTuiActivity(sessionsQuery.data.value?.sessions ?? [], agent.activity),
  );

  function repoLabel(codeRepoId: string): string {
    const repo = repoNames.data.value?.repos.find((r) => r.codeRepoId === codeRepoId);
    return repo?.nickname || repo?.name || codeRepoId;
  }

  const model = computed(() => {
    const b = board.data.value;
    if (!b) return null;
    const workflows = new Map<string, Workflow>();
    for (const entry of workflowsQuery.data.value?.workflows ?? []) {
      if (entry.workflow) workflows.set(entry.workflow.id, entry.workflow);
    }
    const branchById = new Map<string, Branch>(b.branches.map((br) => [br.id, br]));
    const input = (task: Task) => ({
      task,
      workflow: task.workflow ?? workflows.get(task.workflowId) ?? null,
      branch: (id: string) => branchById.get(id),
      repoNick: repoLabel,
    });
    const progress = new Map(b.tasks.map((t) => [t.id, buildTaskProgress(input(t))]));
    const needs = buildNeedsYou({
      board: b,
      sessions: sessions.value,
      progress,
      repoNick: repoLabel,
      nowMs: nowMs.value,
    });

    const cards = new Map<string, PlanCard>();
    for (const task of b.tasks) {
      const taskProgress = progress.get(task.id) as TaskProgress;
      const branches = task.branchIds.flatMap((id) => branchById.get(id) ?? []);
      const i = input(task);
      cards.set(task.id, {
        task,
        title: taskTitle(task, branches[0], ''),
        color: taskColor(task.color),
        progress: taskProgress,
        status: deriveStatus({
          task,
          progress: taskProgress,
          branches,
          hasSessions: sessions.value.some((s) => s.taskId === task.id),
        }),
        blocks: buildStageBlocks(
          i,
          i.workflow,
          taskProgress.stage ?? task.currentStage,
          taskProgress.stageIndex,
          taskProgress.finished,
        ),
        attention: needs.items.find((n) => n.taskId === task.id)?.what ?? '',
        repos: [...new Set(branches.map((br) => repoLabel(br.codeRepoId)))],
      });
    }

    // Plan order within a day; tasks with no day sit under Later.
    const today = localIso(new Date(nowMs.value));
    const rank = new Map(b.plan.order.map((id, k) => [id, k]));
    const ordered = [...cards.values()].sort(
      (a, c) => (rank.get(a.task.id) ?? 1e9) - (rank.get(c.task.id) ?? 1e9),
    );
    const groups = new Map<string, PlanGroup>();
    for (const card of ordered) {
      const day = b.plan.day[card.task.id] ?? '';
      const group = groups.get(day) ?? {
        key: day || 'later',
        label: day ? dayLabel(day, today) : 'Later',
        cards: [],
      };
      group.cards.push(card);
      groups.set(day, group);
    }
    const plan = [...groups.entries()]
      .sort(([a], [c]) => (a === '' ? 1 : c === '' ? -1 : a.localeCompare(c)))
      .map(([, g]) => g);

    return { needs, cards, plan, today };
  });

  return { model, repoLabel, boardQuery: board };
});
