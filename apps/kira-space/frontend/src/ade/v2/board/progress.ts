import type {
  Branch,
  OnFailure,
  RunState,
  RunsOn,
  Stage,
  StepResult,
  Task,
  Workflow,
} from '../wire';
import { implicitResults } from './stepResults';

// Pure port of mockup v2 `renderVals()` step aggregation (1423-1466), `phasePills` (1672-1702) and
// `branchProg` (1768-1787). Runs are the backend's: a stuck run arrives as `state: 'stuck'`.

/** `skipped`: a route went past the step, so it never runs. */
export type StepState = 'pending' | 'running' | 'stuck' | 'failed' | 'done' | 'skipped';

export interface StepRun {
  branchId: string;
  state: RunState;
  loops: number;
  note: string;
  /** The stored outcome's reason, '' while none. */
  reason: string;
  /** The step result the agent reported, '' while none. */
  result: string;
  /** Whether that result was ok; null while none. */
  ok: boolean | null;
  /** Where the result sent the step: next, end, stop, a step id, `back:<id>` or `retry`; '' while none. */
  route: string;
  runId: string;
  sessionId: string;
  finishedAt: number | null;
}

export interface StepProgress {
  id: string;
  /** 1-based position inside the stage. */
  n: number;
  name: string;
  runsOn: RunsOn;
  before: 'auto' | 'approval';
  onFailure: OnFailure | '';
  /** The step's results with their routes. */
  results: StepResult[];
  /** Name of the smart script the step runs, else ''. */
  smartScript: string;
  state: StepState;
  /** One entry per target branch, in task branch order; a branch without a run is `pending`. */
  runs: StepRun[];
  /** Pending, gated on approval, and the previous step is done. */
  approval: boolean;
  /** 0..1: share of target runs done. */
  frac: number;
}

interface StageSegment {
  id: string;
  name: string;
  kind: Stage['kind'];
  /** Agent stages draw wider. */
  wide: boolean;
  state: 'done' | 'current' | 'blocked' | 'todo' | 'skipped';
}

type ProgressTone = 'green' | 'red' | 'amber';

export interface TaskProgress {
  hasWorkflow: boolean;
  finished: boolean;
  stage: Stage | null;
  /** Index of the current stage in the workflow, -1 when the workflow file is unavailable. */
  stageIndex: number;
  steps: StepProgress[];
  doneSteps: number;
  /** A step of the current stage is stuck or failed. */
  bad: boolean;
  segments: StageSegment[];
  /** `Spec`, `Implement 2/5`, `Done`. */
  label: string;
  /** Precise bar for agent and script stages. */
  showBar: boolean;
  percent: number;
  tone: ProgressTone;
  barTip: string;
  workflowTip: string;
}

export interface ProgressInput {
  task: Task;
  /** The task's workflow from the Workflows list; `null` when deleted or never valid. */
  workflow: Workflow | null;
  branch: (id: string) => Branch | undefined;
  /** Repo nickname, falling back to its name. */
  repoNick: (codeRepoId: string) => string;
}

/** Branches a step runs on: `once` is the first mine branch (D12), `each repo` every mine branch,
 *  `only <nick>` the mine branches in that repo. An unmatched `only` has no targets. */
function stepTargets(i: ProgressInput, runsOn: RunsOn | ''): string[] {
  const mine = i.task.branchIds.filter((id) => i.branch(id)?.kind === 'mine');
  if (runsOn === 'once') return mine.slice(0, 1);
  if (runsOn.startsWith('only ')) {
    const nick = runsOn.slice(5);
    return mine.filter((id) => i.repoNick(i.branch(id)?.codeRepoId ?? '') === nick);
  }
  return mine;
}

function aggregate(states: readonly RunState[]): StepState {
  if (!states.length) return 'pending';
  if (states.includes('stuck')) return 'stuck';
  if (states.includes('failed')) return 'failed';
  if (states.includes('running') || states.includes('back')) return 'running';
  return states.every((s) => s === 'done') ? 'done' : 'pending';
}

function runFraction(r: StepRun): number {
  return r.state === 'done' ? 1 : 0;
}

interface StepDef {
  id: string;
  name: string;
  runsOn: RunsOn;
  before: 'auto' | 'approval';
  onFailure: OnFailure | '';
  results: StepResult[];
  smartScript: string;
}

function stepDefs(stage: Stage): StepDef[] {
  if (stage.kind === 'user') return [];
  if (stage.kind === 'script') {
    return [
      {
        id: stage.id,
        name: stage.name,
        runsOn: stage.runsOn || 'once',
        before: 'auto',
        onFailure: stage.onFailure || 'stop',
        results: implicitResults(stage.id, stage.onFailure || 'stop'),
        smartScript: '',
      },
    ];
  }
  return stage.steps.map((s) => ({
    id: s.id,
    name: s.name,
    runsOn: s.runsOn,
    before: s.before,
    onFailure: s.onFailure,
    results: s.results?.length ? s.results : implicitResults(s.id, s.onFailure || 'stop'),
    smartScript: s.smartScript,
  }));
}

/** Latest-attempt run of `(stage, step, branch)` (W12). */
function latestRun(task: Task, stageId: string, stepId: string, branchId: string): StepRun | null {
  let best: Task['runs'][number] | null = null;
  for (const r of task.runs) {
    if (r.stageId !== stageId || r.stepId !== stepId || r.branchId !== branchId) continue;
    if (!best || r.attempt > best.attempt) best = r;
  }
  if (!best) return null;
  return {
    branchId,
    state: best.state,
    loops: best.loops,
    note: best.note,
    reason: best.outcome?.reason ?? '',
    result: best.outcome?.result ?? '',
    ok: best.outcome?.result ? best.outcome.status !== 'failed' : null,
    route: best.outcome?.route ?? '',
    runId: best.id,
    sessionId: best.sessionId,
    finishedAt: best.finishedAt,
  };
}

/** Index of the step after `i` for a done step: the earliest forward route among its runs. Mirrors Go
 *  `forwardTarget`; a run without a stored route counts as `next`. */
function forwardTarget(ids: readonly string[], i: number, runs: readonly StepRun[]): number {
  let next = ids.length;
  for (const r of runs) {
    let to = i + 1;
    if (r.route === 'end') to = ids.length;
    else if (r.route && r.route !== 'next') {
      const j = ids.indexOf(r.route);
      if (j > i) to = j;
    }
    next = Math.min(next, to);
  }
  return Math.max(next, i + 1);
}

/** The route path of a stage: from the first step, a done step moves to its forward target and the
 *  first step not done ends the path. `skipped` marks the steps the route went past. Mirrors Go
 *  `walkPath`. */
export function walkPath(
  ids: readonly string[],
  steps: readonly { state: StepState; runs: readonly StepRun[] }[],
): { path: number[]; skipped: boolean[] } {
  const path: number[] = [];
  const skipped = ids.map(() => false);
  let i = 0;
  while (i < ids.length) {
    path.push(i);
    const step = steps[i];
    if (!step || step.state !== 'done') break;
    const next = forwardTarget(ids, i, step.runs);
    for (let j = i + 1; j < next && j < ids.length; j++) skipped[j] = true;
    i = next;
  }
  return { path, skipped };
}

/** Steps of the task's current stage with per-branch runs, step state and approval flag. */
export function buildSteps(i: ProgressInput, stage: Stage): StepProgress[] {
  const defs = stepDefs(stage);
  const built = defs.map((def, idx) => {
    const runs = stepTargets(i, def.runsOn).map(
      (branchId): StepRun =>
        latestRun(i.task, stage.id, def.id, branchId) ?? {
          branchId,
          state: 'pending',
          loops: 0,
          note: '',
          reason: '',
          result: '',
          ok: null,
          route: '',
          runId: '',
          sessionId: '',
          finishedAt: null,
        },
    );
    const state = aggregate(runs.map((r) => r.state));
    const frac = runs.length ? runs.reduce((acc, r) => acc + runFraction(r), 0) / runs.length : 0;
    return { ...def, n: idx + 1, state, runs, approval: false, frac };
  });
  const { path, skipped } = walkPath(
    defs.map((d) => d.id),
    built,
  );
  const end = path[path.length - 1] ?? -1;
  return built.map((s, idx) => {
    if (skipped[idx]) return { ...s, state: 'skipped', frac: 1 };
    const approval = s.state === 'pending' && s.before === 'approval' && idx > 0 && idx === end;
    return { ...s, approval };
  });
}

export function buildTaskProgress(i: ProgressInput): TaskProgress {
  const { task, workflow } = i;
  const stage = task.currentStage;
  const finished = task.workflowId !== '' && task.stageId === 'done';
  const hasWorkflow = finished || stage !== null;
  if (!hasWorkflow) {
    return {
      hasWorkflow: false,
      finished: false,
      stage: null,
      stageIndex: -1,
      steps: [],
      doneSteps: 0,
      bad: false,
      segments: [],
      label: '',
      showBar: false,
      percent: 0,
      tone: 'amber',
      barTip: '',
      workflowTip: '',
    };
  }
  const stages: readonly Stage[] = workflow?.stages ?? (stage ? [stage] : []);
  const found = stage ? stages.findIndex((s) => s.id === stage.id) : -1;
  const idx = finished ? stages.length : found;
  const steps = !finished && stage ? buildSteps(i, stage) : [];
  const bad = steps.some((s) => s.state === 'stuck' || s.state === 'failed');
  const doneSteps = steps.filter((s) => s.state === 'done' || s.state === 'skipped').length;
  const frac = steps.length ? steps.reduce((acc, s) => acc + s.frac, 0) / steps.length : 0;
  const segments = stages.map((s, k): StageSegment => {
    let state: StageSegment['state'] = 'todo';
    if (s.skip && k !== idx) state = 'skipped';
    else if (k < idx) state = 'done';
    else if (k === idx) state = bad ? 'blocked' : 'current';
    return { id: s.id, name: s.name, kind: s.kind, wide: s.kind === 'agent', state };
  });
  const label =
    finished || !stage
      ? 'Done'
      : stage.name + (stage.kind === 'agent' ? ` ${doneSteps}/${steps.length}` : '');
  const nick = (id: string): string => i.repoNick(i.branch(id)?.codeRepoId ?? '');
  return {
    hasWorkflow: true,
    finished,
    stage: finished ? null : stage,
    stageIndex: workflow ? idx : -1,
    steps,
    doneSteps,
    bad,
    segments,
    label,
    showBar: !finished && stage !== null && stage.kind !== 'user',
    percent: Math.round(frac * 100),
    tone: finished ? 'green' : bad ? 'red' : 'amber',
    barTip: steps
      .map(
        (s) =>
          `${s.n}. ${s.name}: ${s.runs
            .map((r) => {
              const mid = r.state === 'done' ? '✓' : r.state;
              return `${nick(r.branchId)} ${mid}`;
            })
            .join(', ')}`,
      )
      .join('\n'),
    workflowTip: `${workflow?.name ?? task.workflowId}: ${stages
      .map((s, k) => `${k < idx ? '✓ ' : k === idx ? '▸ ' : ''}${s.name} (${s.kind})`)
      .join(' › ')}`,
  };
}

export type BranchSegState = 'done' | 'running' | 'bad' | 'pending';

export interface BranchProgress {
  segments: BranchSegState[];
  /** `Implement`, `Implement · stuck`, `Tests ↩ sent back`, `Implement ✓`. */
  label: string;
  tone: 'amber' | 'red' | 'green' | 'grey';
  tip: string;
}

/** One branch's own line during agent/script stages; `null` outside them or without a step on it. */
export function branchProgress(p: TaskProgress, branchId: string): BranchProgress | null {
  const stage = p.stage;
  if (!stage || stage.kind === 'user') return null;
  const own: { step: StepProgress; run: StepRun }[] = [];
  for (const step of p.steps) {
    if (step.state === 'skipped') continue;
    const run = step.runs.find((r) => r.branchId === branchId);
    if (run) own.push({ step, run });
  }
  if (!own.length) return null;
  const segments = own.map(({ run }): BranchSegState => {
    if (run.state === 'done') return 'done';
    if (run.state === 'running' || run.state === 'back') return 'running';
    return run.state === 'stuck' || run.state === 'failed' ? 'bad' : 'pending';
  });
  const pos = own.find(({ run }) => run.state !== 'done');
  let label: string;
  let tone: BranchProgress['tone'] = 'amber';
  if (!pos) {
    label = `${stage.name} ✓`;
    tone = 'green';
  } else if (pos.run.state === 'back') {
    label =
      pos.run.route === 'retry'
        ? `${pos.step.name} · ${pos.run.note}`
        : `${pos.step.name} ↩ sent back`;
  } else {
    const suffix = { stuck: ' · stuck', failed: ' · failed', pending: ' · waiting' } as Record<
      string,
      string
    >;
    label =
      pos.step.name +
      (pos.run.loops ? ` · fix ${pos.run.loops}` : '') +
      (suffix[pos.run.state] ?? '');
    if (pos.run.state === 'stuck' || pos.run.state === 'failed') tone = 'red';
    else if (pos.run.state === 'pending') tone = 'grey';
  }
  const tip = own
    .map(
      ({ step, run }) => `${step.n}. ${step.name}: ${run.state}${run.note ? ` (${run.note})` : ''}`,
    )
    .join('\n');
  return { segments, label, tone, tip };
}
