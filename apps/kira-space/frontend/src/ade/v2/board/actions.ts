import type { TextPart } from '@theme/varText';
import type { Branch, Plan, Run, Session, Task } from '../wire';
import { type BranchGraph, shortBranchName } from './branchGraph';
import type { TaskProgress } from './progress';
import { type RebaseAct, rebaseActs } from './rebaseActions';
import type { DerivedStatus } from './status';

// Left action column: task stage action and branch tag + action, both first-match tables
// (SPEC2 §4.2, mockup v2 lines 1855-1856 and 1934-1957).

export type Tone = 'amber' | 'red' | 'green' | 'blue' | 'purple' | 'grey';

export const STATUS_TONE: Record<DerivedStatus, Tone> = {
  'To do': 'grey',
  'In progress': 'amber',
  'In review': 'blue',
  Blocked: 'red',
  Done: 'green',
};

// ---- task cell

type TaskActionKind =
  | 'archive'
  | 'stage'
  | 'done'
  | 'finish'
  | 'takeOver'
  | 'approve'
  | 'run'
  | 'retry';

export interface TaskAction {
  kind: TaskActionKind;
  label: string;
  tip: string;
  tone: 'claude' | 'red' | 'amber' | 'green' | 'purple';
  /** Step the action applies to (`approve`, `retry`, `takeOver`). */
  stepId?: string;
  /** Session to open for `takeOver`. */
  sessionId?: string;
}

export interface TaskCell {
  tag: { label: string; tone: Tone; tip: string };
  action: TaskAction | null;
}

export interface TaskCellInput {
  task: Task;
  progress: TaskProgress;
  status: DerivedStatus;
  /** The task's branches. */
  branches: readonly Branch[];
  /** The task's sessions. */
  sessions: readonly Session[];
}

export const ARCHIVE_TIP =
  'Stop its agents, delete its worktrees and hide it. Branches, notes and links are kept; it stays in history.';

function doneAction(p: TaskProgress): TaskAction {
  const rest = p.segments.slice(p.stageIndex + 1).filter((s) => s.state !== 'skipped');
  const last = p.stageIndex >= 0 && rest.length === 0;
  const stage = p.stage?.name ?? '';
  if (last) return { kind: 'finish', label: 'Finish ✓', tip: 'finish the workflow', tone: 'green' };
  const next = rest[0]?.name;
  return {
    kind: 'done',
    label: 'Done ›',
    tip: next ? `${stage} is done; move to ${next}` : `${stage} is done`,
    tone: 'green',
  };
}

function userStageAction(i: TaskCellInput): TaskAction {
  const { progress: p, sessions } = i;
  const stage = p.stage;
  // The review agent is the stage's session only on the review stage.
  const talking = sessions.some(
    (s) =>
      s.mode === 'tui' &&
      s.state === 'running' &&
      (s.purpose !== 'review' || stage?.id === 'review'),
  );
  if (stage?.session && !talking) {
    return {
      kind: 'stage',
      label: `▶ ${stage.name}`,
      tip: `open an interactive Claude Code session for ${stage.name}`,
      tone: 'claude',
    };
  }
  return doneAction(p);
}

function scriptStageAction(p: TaskProgress): TaskAction | null {
  const sc = p.steps[0];
  const stage = p.stage;
  if (!sc || !stage) return null;
  if (sc.state === 'failed' || sc.state === 'stuck') {
    return {
      kind: 'retry',
      label: 'Retry',
      tip: `${stage.name} ${sc.state}: see its output in the Task tab`,
      tone: 'red',
      stepId: sc.id,
    };
  }
  if (sc.state === 'pending') {
    return {
      kind: 'run',
      label: '▶ Run',
      tip: `run: ${stage.command}`,
      tone: 'claude',
      stepId: sc.id,
    };
  }
  return sc.state === 'done' ? doneAction(p) : null;
}

function agentStageAction(p: TaskProgress): TaskAction | null {
  const stage = p.stage;
  if (!stage) return null;
  const stuck = p.steps.find((s) => s.state === 'stuck' || s.state === 'failed');
  const session = stuck?.runs.find((r) => r.sessionId !== '')?.sessionId;
  if (stuck && session) {
    return {
      kind: 'takeOver',
      label: 'Take over',
      tip: `${stuck.name} needs you: continue it yourself in Claude Code`,
      tone: 'red',
      stepId: stuck.id,
      sessionId: session,
    };
  }
  const gated = p.steps.find((s) => s.approval);
  if (gated) {
    return {
      kind: 'approve',
      label: 'Approve',
      tip: `run "${gated.name}"`,
      tone: 'amber',
      stepId: gated.id,
    };
  }
  if (p.steps.length && p.steps.every((s) => s.state === 'pending')) {
    return {
      kind: 'run',
      label: '▶ Run',
      tip: `run ${stage.name} with background agents (claude -p)`,
      tone: 'claude',
    };
  }
  return p.steps.length && p.steps.every((s) => s.state === 'done') ? doneAction(p) : null;
}

function stageAction(i: TaskCellInput): TaskAction | null {
  const stage = i.progress.stage;
  if (!stage) return null;
  if (stage.kind === 'user') return userStageAction(i);
  return stage.kind === 'script' ? scriptStageAction(i.progress) : agentStageAction(i.progress);
}

/** Header cell of a task row, `null` for a review item (it has no task row). */
export function taskCell(i: TaskCellInput): TaskCell | null {
  const { task, progress } = i;
  if (task.kind === 'review') return null;
  if (task.kind === 'parked') {
    return { tag: { label: 'not merging', tone: 'grey', tip: 'task status' }, action: null };
  }
  const mine = i.branches.filter((b) => b.kind === 'mine');
  const allMerged = mine.length > 0 && mine.every((b) => b.mergedIntoMain);
  if (progress.finished || (allMerged && !progress.hasWorkflow)) {
    return {
      tag: { label: '✓ merged', tone: 'purple', tip: 'every branch landed on main' },
      action: { kind: 'archive', label: 'Archive', tip: ARCHIVE_TIP, tone: 'purple' },
    };
  }
  return {
    tag: { label: i.status, tone: STATUS_TONE[i.status], tip: 'task status' },
    action: stageAction(i),
  };
}

// ---- branch cell

type BranchActionKind =
  | 'seeError'
  | 'forcePush'
  | 'rebase'
  | 'queue'
  | 'changeBase'
  | 'abortRebase'
  | 'seeLog'
  | 'takeOver'
  | 'start';

export interface BranchAction {
  kind: BranchActionKind;
  label: string;
  tip: string;
  /** The tip with its base and branch names as variables, when it names any. */
  tipParts?: readonly TextPart[];
  disabled?: boolean;
  /** `rebase` / `queue` / `changeBase` / `abortRebase`: what the button runs. */
  act?: RebaseAct;
  /** `takeOver`: the rebase run's session. */
  sessionId?: string;
}

export interface BranchTag {
  label: string;
  tone: Tone;
  tip: string;
  /** The tip with its base names as variables, when it names any. */
  tipParts?: readonly TextPart[];
  actions: BranchAction[];
  /** Start of a running setup; the label's elapsed time re-reads the clock (`tagLabel`). */
  since?: number;
}

export function tagLabel(tag: { label: string; since?: number }, nowMs: number): string {
  return tag.since === undefined ? tag.label : `⚙ preparing ${formatElapsed(nowMs - tag.since)}`;
}

export interface BranchTagInput {
  branch: Branch;
  graph: BranchGraph;
  plan: Pick<Plan, 'unpushed'>;
  /** `TimelineView.after`: earlier-merging branch this one shares files with. */
  after: ReadonlyMap<string, { id: string; file: string }>;
  nowMs: number;
  /** The branch ever had a session (running or stopped). */
  hadSession: boolean;
  /** Short name of the repo's main branch, `''` when unresolved. */
  mainName: string;
  /** Runs of the branch's task. */
  runs: readonly Run[];
}

type Rule = (i: BranchTagInput) => BranchTag | null;

const tag = (label: string, tone: Tone, tip: string, actions: BranchAction[] = []): BranchTag => ({
  label,
  tone,
  tip,
  actions,
});

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function nameOf(i: BranchTagInput, id: string): string {
  return i.graph.byBranch.get(id)?.name ?? id;
}

function rootIsMain(i: BranchTagInput): boolean {
  const p = i.graph.parentOf.get(i.branch.id);
  return p === undefined || i.graph.byBranch.get(p)?.kind !== 'mine';
}

function baseLabel(i: BranchTagInput): string {
  const b = i.branch;
  return b.baseBranchId === '' && (b.base === '' || b.base === i.mainName) ? 'main' : b.base;
}

function rebaseConflict(i: BranchTagInput): string[] {
  return i.branch.conflictCheck === 'done' ? i.branch.conflictsIfRebased : [];
}

const notCreated: Rule = (i) =>
  i.branch.name === ''
    ? tag('not created', 'grey', 'Claude creates it when the task starts')
    : null;

const preparing: Rule = (i) => {
  const s = i.branch.setup;
  if (s?.state !== 'running') return null;
  return {
    ...tag(
      `⚙ preparing ${formatElapsed(i.nowMs - s.startedAt)}`,
      'blue',
      'running the prepare-worktree script',
    ),
    since: s.startedAt,
  };
};

const setupFailed: Rule = (i) =>
  i.branch.setup?.state === 'failed'
    ? tag('✕ setup failed', 'red', i.branch.setup.note || 'the prepare-worktree script failed', [
        { kind: 'seeError', label: 'See error', tip: 'open the setup log' },
      ])
    : null;

const merged: Rule = (i) =>
  i.branch.mergedIntoMain ? tag('✓ merged', 'purple', 'landed on main') : null;

const parked: Rule = (i) =>
  i.branch.kind === 'parked' ? tag('not merging', 'grey', 'kept out of the merge order') : null;

const review: Rule = (i) => {
  if (i.branch.kind !== 'review') return null;
  const conf = i.graph.conflicts.get(i.branch.id)?.[0];
  return conf
    ? tag('✕ conflict', 'red', `overlaps ${nameOf(i, conf.with)}: ${conf.files.join(', ')}`)
    : tag('review', 'blue', "someone else's branch");
};

const conflict: Rule = (i) => {
  const conf = i.graph.conflicts.get(i.branch.id)?.[0];
  if (!conf) return null;
  const name = nameOf(i, conf.with);
  return tag(
    '✕ conflict',
    'red',
    `conflicts with ${name}: ${conf.files.join(', ')}`,
    actsOf(i, 'queue'),
  );
};

const SHORT: Record<RebaseAct['kind'], string> = {
  rebase: 'Rebase',
  queue: 'Queue after',
  changeBase: 'Change base',
  abortRebase: 'Abort rebase',
};

function actionOf(act: RebaseAct): BranchAction {
  const label = act.kind === 'rebase' && act.retry ? 'Retry rebase' : SHORT[act.kind];
  return {
    kind: act.kind,
    label,
    tip: plain(act.tip),
    tipParts: act.tip,
    disabled: act.disabled,
    act,
  };
}

const plain = (parts: readonly TextPart[]): string =>
  parts.map((p) => (typeof p === 'string' ? p : p.value)).join('');

/** The rebase acts of the branch whose ids are listed, as tag buttons. */
function actsOf(i: BranchTagInput, ...ids: string[]): BranchAction[] {
  return rebaseActs({
    branch: i.branch,
    graph: i.graph,
    after: i.after,
    runs: i.runs,
    mainName: i.mainName,
  })
    .filter((a) => ids.includes(a.id))
    .map(actionOf);
}

function lastRebase(i: BranchTagInput): Run | null {
  let best: Run | null = null;
  for (const r of i.runs) {
    if (
      r.purpose === 'rebase' &&
      r.branchId === i.branch.id &&
      (!best || r.attempt >= best.attempt)
    ) {
      best = r;
    }
  }
  return best;
}

const seeLog: BranchAction = { kind: 'seeLog', label: 'See log', tip: 'open the rebase log' };

function takeOverOf(run: Run | null): BranchAction[] {
  return run && run.sessionId !== ''
    ? [
        {
          kind: 'takeOver',
          label: 'Take over',
          tip: 'continue the rebase yourself in Claude Code',
          sessionId: run.sessionId,
        },
      ]
    : [];
}

const rebasing: Rule = (i) => {
  const run = lastRebase(i);
  return run && (run.state === 'running' || run.state === 'pending')
    ? tag('⟳ rebasing', 'blue', 'A background run is rebasing this branch', [seeLog])
    : null;
};

const rebasePending: Rule = (i) => {
  const b = i.branch;
  if (b.kind !== 'mine' || b.basePendingFrom === '') return null;
  const run = lastRebase(i);
  const reason = run?.outcome?.reason ? `\n${run.outcome.reason}` : '';
  const parts: TextPart[] = [
    'Base changed from ',
    { name: 'base', value: b.basePendingFrom },
    ' to ',
    { name: 'base', value: b.base },
    '. The branch is not rebased onto it yet.',
    ...(reason ? [reason] : []),
  ];
  return {
    ...tag('⚠ base changed, rebase pending', 'amber', plain(parts), [
      ...actsOf(i, 'rebase-retry', 'abort-rebase'),
      ...(run ? [seeLog] : []),
      ...takeOverOf(run && (run.state === 'failed' || run.state === 'stuck') ? run : null),
    ]),
    tipParts: parts,
  };
};

const rebaseRunFailed: Rule = (i) => {
  const run = lastRebase(i);
  if (!run || (run.state !== 'failed' && run.state !== 'stuck')) return null;
  const stuck = run.state === 'stuck';
  return tag(
    stuck ? '✋ rebase needs you' : '✕ rebase failed',
    'red',
    run.outcome?.reason || (stuck ? 'the rebase agent needs you' : 'the last rebase failed'),
    [
      ...actsOf(i, 'rebase-retry', 'rebase-base', 'rebase-self', 'abort-rebase'),
      seeLog,
      ...takeOverOf(run),
    ],
  );
};

const rebaseInProgress: Rule = (i) =>
  i.branch.kind === 'mine' && i.branch.rebaseInProgress
    ? tag(
        '⚠ rebase in progress',
        'amber',
        'a rebase is left half-done in the worktree',
        actsOf(i, 'abort-rebase'),
      )
    : null;

const baseMissing: Rule = (i) => {
  const b = i.branch;
  if (b.kind !== 'mine' || !b.baseMissing) return null;
  const parts: TextPart[] = ['Base ', { name: 'base', value: b.base }, ' no longer exists'];
  return {
    ...tag('✕ base missing', 'red', plain(parts), actsOf(i, 'change-base')),
    tipParts: parts,
  };
};

const rebaseConflicts: Rule = (i) => {
  const paths = rebaseConflict(i);
  if (!paths.length) return null;
  const base = baseLabel(i);
  return tag(
    '✕ conflict',
    'red',
    `conflicts with ${base} if rebased: ${paths.join(', ')}`,
    actsOf(i, 'rebase-base', 'rebase-self'),
  );
};

const notPushed: Rule = (i) =>
  i.plan.unpushed[i.branch.id]
    ? tag('↑ not pushed', 'amber', 'rebased locally; the remote still has the old commits', [
        { kind: 'forcePush', label: 'Force push', tip: 'git push --force-with-lease' },
      ])
    : null;

const behindMain: Rule = (i) =>
  rootIsMain(i) && i.branch.behind > 0
    ? tag(
        `↓${i.branch.behind} ${baseLabel(i)}`,
        'amber',
        `${i.branch.behind} commits behind ${baseLabel(i)}`,
        actsOf(i, 'rebase-base'),
      )
    : null;

const sharesFiles: Rule = (i) => {
  const a = i.after.get(i.branch.id);
  if (!a) return null;
  const name = nameOf(i, a.id);
  return tag(
    `↻ ${shortBranchName(name)}`,
    'amber',
    `shares ${a.file} with ${name}; merges after it`,
    actsOf(i, 'rebase-onto'),
  );
};

const waitingOnReview: Rule = (i) => {
  const pid = i.graph.parentOf.get(i.branch.id);
  const p = pid === undefined ? undefined : i.graph.byBranch.get(pid);
  return p?.kind === 'review' ? tag(`⏳ ${p.owner}`, 'blue', `based on ${p.name}`) : null;
};

const baseNeedsAttention: Rule = (i) => {
  const anc = i.graph.ancestors(i.branch.id).map((id) => i.graph.byBranch.get(id));
  const conflicted = anc.some(
    (a) =>
      a &&
      ((i.graph.conflicts.get(a.id)?.length ?? 0) > 0 ||
        (a.conflictCheck === 'done' && a.conflictsIfRebased.length > 0)),
  );
  const label = conflicted
    ? 'base conflict'
    : anc.some((a) => (a?.behind ?? 0) > 0)
      ? 'base behind'
      : '';
  return label ? tag(label, 'amber', 'the branch it is stacked on needs attention') : null;
};

const checking: Rule = (i) =>
  i.branch.conflictCheck === 'checking'
    ? tag('checking…', 'grey', 'checking whether a rebase would conflict')
    : null;

const checkFailed: Rule = (i) =>
  i.branch.conflictCheck === 'failed'
    ? tag('conflict check failed', 'amber', i.branch.conflictCheckReason || 'conflict check failed')
    : null;

const clean: Rule = () => tag('✓ clean', 'green', 'no shared files with work merging before it');

// First match wins; `clean` is the unconditional last rung.
const BRANCH_RULES: readonly Rule[] = [
  notCreated,
  preparing,
  setupFailed,
  merged,
  parked,
  review,
  rebasing,
  rebasePending,
  rebaseRunFailed,
  rebaseInProgress,
  baseMissing,
  conflict,
  rebaseConflicts,
  notPushed,
  behindMain,
  sharesFiles,
  waitingOnReview,
  baseNeedsAttention,
  checking,
  checkFailed,
  clean,
];

export function branchTag(i: BranchTagInput): BranchTag {
  let result: BranchTag = tag('✓ clean', 'green', '');
  for (const rule of BRANCH_RULES) {
    const t = rule(i);
    if (t) {
      result = t;
      break;
    }
  }
  const b = i.branch;
  const setupOk = b.setup === null || b.setup.state === 'ready';
  if (b.kind === 'mine' && b.name !== '' && !b.mergedIntoMain && !i.hadSession && setupOk) {
    result.actions.push({
      kind: 'start',
      label: '▶ Start',
      tip: 'start Claude Code in its worktree',
    });
  }
  return result;
}
