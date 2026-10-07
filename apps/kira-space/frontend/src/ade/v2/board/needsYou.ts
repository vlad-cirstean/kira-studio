import type { Board, Session } from '../wire';
import { formatElapsed } from './actions';
import type { TaskProgress } from './progress';

// Needs-you list (SPEC2 §11), mockup v2 lines 2490-2520. No CI item: D9 has no CI badge.

export type NeedsKind =
  | 'stuck run'
  | 'failed'
  | 'question'
  | 'approval'
  | 'setup failed'
  | 'stale merge';

/** Most urgent first (SPEC2 §11); ties break oldest first. */
export const NEEDS_RANK: readonly NeedsKind[] = [
  'stuck run',
  'failed',
  'question',
  'approval',
  'setup failed',
  'stale merge',
];

const ACTION: Record<
  NeedsKind,
  'Take over' | 'Retry' | 'Open' | 'Approve' | 'See error' | 'Re-merge'
> = {
  'stuck run': 'Take over',
  failed: 'Retry',
  question: 'Open',
  approval: 'Approve',
  'setup failed': 'See error',
  'stale merge': 'Re-merge',
};

const TONE: Record<NeedsKind, 'red' | 'amber' | 'grey'> = {
  'stuck run': 'red',
  failed: 'red',
  question: 'amber',
  approval: 'amber',
  'setup failed': 'red',
  'stale merge': 'grey',
};

export interface NeedsItem {
  /** Stable key: kind plus the ids it points at. */
  id: string;
  kind: NeedsKind;
  tone: 'red' | 'amber' | 'grey';
  action: (typeof ACTION)[NeedsKind];
  taskId: string;
  /** `''` for a task-level item (spec session, failed step). */
  branchId: string;
  stepId: string;
  sessionId: string;
  /** `approval`: the stage the step belongs to. */
  stageId: string;
  /** `stale merge`: the integration branch it is stale in. */
  target: string;
  /** `Retry`: the latest failed or stuck runs to re-run. */
  runIds: string[];
  /** Repo nickname, `spec`, or the step's `runs_on`. */
  scope: string;
  what: string;
  /** Extra fact, e.g. `took 1m 12s`; `''` when none. */
  detail: string;
  /** Milliseconds since it started needing you; `null` when unknown. */
  ageMs: number | null;
}

export interface NeedsYou {
  items: NeedsItem[];
  empty: boolean;
  /** Tab badge: the item count. */
  badge: number;
  backgroundRuns: number;
  interactiveSessions: number;
  footer: string;
}

export interface NeedsYouInput {
  board: Pick<Board, 'tasks' | 'branches'>;
  sessions: readonly Session[];
  progress: ReadonlyMap<string, TaskProgress>;
  repoNick: (codeRepoId: string) => string;
  nowMs: number;
}

type Extra = Partial<NeedsItem> & Pick<NeedsItem, 'id' | 'taskId' | 'what'>;

function item(kind: NeedsKind, o: Extra): NeedsItem {
  return {
    kind,
    tone: TONE[kind],
    action: ACTION[kind],
    branchId: '',
    stepId: '',
    sessionId: '',
    stageId: '',
    target: '',
    runIds: [],
    scope: '',
    detail: '',
    ageMs: null,
    ...o,
  };
}

interface Ctx {
  i: NeedsYouInput;
  nick(branchId: string): string;
  nameOf(branchId: string): string;
  age(at: number | null | undefined): number | null;
  sessionsById: ReadonlyMap<string, Session>;
}

function stepItems(c: Ctx): NeedsItem[] {
  const out: NeedsItem[] = [];
  for (const task of c.i.board.tasks) {
    for (const step of c.i.progress.get(task.id)?.steps ?? []) {
      for (const r of step.runs.filter((x) => x.state === 'stuck')) {
        out.push(
          item('stuck run', {
            id: `stuck:${task.id}:${step.id}:${r.branchId}`,
            taskId: task.id,
            branchId: r.branchId,
            stepId: step.id,
            sessionId: r.sessionId,
            // A script run has no session to take over: it is retried.
            action: r.sessionId ? 'Take over' : 'Retry',
            runIds: r.runId ? [r.runId] : [],
            scope: c.nick(r.branchId),
            what: `Step "${step.name}" is stuck on ${c.nameOf(r.branchId)}`,
            detail: r.note,
            ageMs: c.age(c.sessionsById.get(r.sessionId)?.lastActiveAt ?? r.finishedAt),
          }),
        );
      }
      const base = { taskId: task.id, stepId: step.id, scope: step.runsOn };
      if (step.state === 'failed') {
        const failed = step.runs.filter((x) => x.state === 'failed' || x.state === 'stuck');
        out.push(
          item('failed', {
            ...base,
            id: `failed:${task.id}:${step.id}`,
            what: `Step "${step.name}" failed`,
            runIds: failed.flatMap((x) => (x.runId ? [x.runId] : [])),
            detail: failed.find((x) => x.note)?.note ?? '',
            ageMs: c.age(Math.max(0, ...failed.map((x) => x.finishedAt ?? 0))),
          }),
        );
      }
      if (step.approval) {
        out.push(
          item('approval', {
            ...base,
            id: `approval:${task.id}:${step.id}`,
            stageId: c.i.progress.get(task.id)?.stage?.id ?? '',
            what: `Approve step "${step.name}"`,
          }),
        );
      }
    }
  }
  return out;
}

function questionItems(c: Ctx): NeedsItem[] {
  const taskIds = new Set(c.i.board.tasks.map((t) => t.id));
  return c.i.sessions
    .filter(
      (s) =>
        s.mode === 'tui' &&
        s.state === 'running' &&
        s.activity === 'input' &&
        taskIds.has(s.taskId),
    )
    .map((s) =>
      item('question', {
        id: `question:${s.id}`,
        taskId: s.taskId,
        branchId: s.branchId,
        sessionId: s.id,
        scope: s.branchId ? c.nick(s.branchId) : 'spec',
        what: `Claude Code is waiting for your answer${s.branchId ? ` on ${c.nameOf(s.branchId)}` : ' (spec)'}`,
        ageMs: c.age(s.lastActiveAt),
      }),
    );
}

function branchItems(c: Ctx): NeedsItem[] {
  const out: NeedsItem[] = [];
  for (const b of c.i.board.branches) {
    if (b.setup?.state === 'failed') {
      out.push(
        item('setup failed', {
          id: `setup:${b.id}`,
          taskId: b.taskId,
          branchId: b.id,
          scope: c.nick(b.id),
          what: `Worktree setup failed for ${c.nameOf(b.id)}`,
          detail:
            b.setup.note ||
            (b.setup.finishedAt
              ? `took ${formatElapsed(b.setup.finishedAt - b.setup.startedAt)}`
              : ''),
          ageMs: c.age(b.setup.finishedAt),
        }),
      );
    }
    for (const g of b.integration.filter((x) => x.status === 'stale')) {
      out.push(
        item('stale merge', {
          id: `stale:${b.id}:${g.target}`,
          target: g.target,
          taskId: b.taskId,
          branchId: b.id,
          scope: c.nick(b.id),
          what: `${c.nameOf(b.id)} is stale in ${g.target}`,
        }),
      );
    }
  }
  return out;
}

export function buildNeedsYou(i: NeedsYouInput): NeedsYou {
  const branches = new Map(i.board.branches.map((b) => [b.id, b]));
  const c: Ctx = {
    i,
    nick: (id) => i.repoNick(branches.get(id)?.codeRepoId ?? ''),
    nameOf: (id) => branches.get(id)?.name || 'new branch',
    age: (at) => (at ? Math.max(0, i.nowMs - at) : null),
    sessionsById: new Map(i.sessions.map((s) => [s.id, s])),
  };
  const rank = (k: NeedsKind): number => NEEDS_RANK.indexOf(k);
  const items = [...stepItems(c), ...questionItems(c), ...branchItems(c)].sort(
    (a, b) => rank(a.kind) - rank(b.kind) || (b.ageMs ?? -1) - (a.ageMs ?? -1),
  );
  const running = i.sessions.filter((s) => s.state === 'running');
  const backgroundRuns = running.filter((s) => s.mode === 'headless').length;
  const interactiveSessions = running.filter((s) => s.mode === 'tui').length;
  return {
    items,
    empty: items.length === 0,
    badge: items.length,
    backgroundRuns,
    interactiveSessions,
    footer: `${backgroundRuns} background runs · ${interactiveSessions} interactive sessions`,
  };
}
