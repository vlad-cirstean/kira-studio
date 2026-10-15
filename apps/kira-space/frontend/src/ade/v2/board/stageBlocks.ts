import { t } from '@theme/i18n';
import { reviewPhaseLabel, runStateLabel } from '../runState';
import type { Stage, Workflow } from '../wire';
import type { Tone } from './actions';
import {
  buildSteps,
  type ProgressInput,
  type StepProgress,
  type StepRun,
  type StepState,
} from './progress';
import { defaultRoute } from './stepResults';
import { runsOnLabel } from './workflowForm';

// Task panel Workflow block (SPEC2 section 7, mockup `phaseBlocks`): one block per stage, steps with
// their per-repo run lines. Pure, so the card model carries it ready to render.

interface RunLine {
  run: StepRun;
  glyph: string;
  tone: Tone;
  status: string;
  /** The run's own note, else `fix round n of max` for a fix run (`fix round n` without a budget). */
  note: string;
  /** `↩ 2/3` (`↩ 2` with no limit) once the step went back; '' before. */
  returns: string;
  returnsTip: string;
  /** The run stopped because the step used all its returns. */
  returnsSpent: boolean;
  /** Log (agent) / Output (script) opens the run's log: shown once the run started. */
  hasLog: boolean;
  canRetry: boolean;
  canResume: boolean;
  /** Review step run waiting on or between rounds: the Review button opens the window. */
  canReview: boolean;
}

interface StepView {
  step: StepProgress;
  statusText: string;
  tone: Tone;
  /** Agent: the `runsOn` text; script: the command. */
  scope: string;
  gated: boolean;
  routeText: string;
  runs: RunLine[];
}

export interface StageBlock {
  stage: Stage;
  state: 'done' | 'now' | 'next' | 'skipped';
  steps: StepView[];
  /** `2/5` for an agent stage, else ''. */
  count: string;
  mode: string;
  /** The Release block lists the task's branches instead of steps. */
  release: boolean;
}

const RUN_GLYPH: Record<StepRun['state'], { glyph: string; tone: Tone }> = {
  done: { glyph: '✓', tone: 'green' },
  running: { glyph: '●', tone: 'amber' },
  back: { glyph: '↩', tone: 'amber' },
  stuck: { glyph: '!', tone: 'red' },
  failed: { glyph: '✕', tone: 'red' },
  pending: { glyph: '○', tone: 'grey' },
  review: { glyph: '◐', tone: 'blue' },
};

const STEP_TONE: Record<StepState, Tone> = {
  done: 'green',
  running: 'amber',
  review: 'blue',
  stuck: 'red',
  failed: 'red',
  pending: 'grey',
  skipped: 'grey',
};

function stepStatusText(s: StepProgress): string {
  if (s.state === 'stuck') return t('space.ade.allSessions.stuck.status');
  if (s.state === 'pending' && s.approval) return t('space.ade.stage.waitingApproval.status');
  return runStateLabel(s.state);
}

/** The step's non-default routes, `changes ↩ Implement`, `trivial → end`; '' when it has none. */
function routeText(s: StepProgress, stage: Stage): string {
  const at = new Map(stage.steps.map((x, i) => [x.id, i]));
  const own = at.get(s.id) ?? -1;
  const nameOf = (id: string): string => stage.steps.find((x) => x.id === id)?.name ?? id;
  const parts: string[] = [];
  for (const r of s.results) {
    if (r.next === defaultRoute(r.ok)) continue;
    if (r.next === 'end') parts.push(t('space.ade.stage.routeEnd.label', { id: r.id }));
    else if (r.next === 'stop') parts.push(t('space.ade.stage.routeStop.label', { id: r.id }));
    else if (r.next === s.id) parts.push(t('space.ade.stage.routeRetry.label', { id: r.id }));
    else if ((at.get(r.next) ?? Number.POSITIVE_INFINITY) <= own)
      parts.push(t('space.ade.stage.routeBack.label', { id: r.id, step: nameOf(r.next) }));
    else parts.push(t('space.ade.stage.routeGoto.label', { id: r.id, step: nameOf(r.next) }));
  }
  return parts.join(' · ');
}

function runStatus(r: StepRun): string {
  if (r.state === 'done') {
    return r.ok === false ? t('space.ade.stage.failedContinued.status') : runStateLabel('done');
  }
  if (r.state === 'back') {
    return r.route === 'retry'
      ? t('common.action.retry.label')
      : t('space.ade.outcome.back.status');
  }
  if (r.state === 'review' && r.review) return reviewPhaseLabel(r.review.phase);
  return runStateLabel(r.state);
}

/** Limit of the steps that send the stage back to step `id`: the largest `maxReturns`, 0 when none. */
function backLimit(steps: readonly StepProgress[], id: string): number {
  let limit = 0;
  for (const s of steps) {
    if (s.id !== id && s.results.some((r) => r.next === id)) limit = Math.max(limit, s.maxReturns);
  }
  return limit;
}

function fixRound(loops: number, max: number): string {
  if (!loops) return '';
  return max
    ? t('space.ade.stage.fixRoundMax.status', { count: loops, max })
    : t('space.ade.stage.fixRound.status', { count: loops });
}

function returnsChip(
  r: StepRun,
  limit: number,
): Pick<RunLine, 'returns' | 'returnsTip' | 'returnsSpent'> {
  if (r.returns === 0) return { returns: '', returnsTip: '', returnsSpent: false };
  const vars = { count: r.returns, limit };
  const spent = r.state === 'failed' && r.route === 'stop' && limit > 0 && r.returns >= limit;
  return limit > 0
    ? {
        returns: t('space.ade.stage.returns.label', vars),
        returnsTip: t('space.ade.stage.returns.tooltip', vars),
        returnsSpent: spent,
      }
    : {
        returns: t('space.ade.stage.returnsUnlimited.label', vars),
        returnsTip: t('space.ade.stage.returnsUnlimited.tooltip', vars),
        returnsSpent: false,
      };
}

function runLine(r: StepRun, max: number, limit: number): RunLine {
  const g = RUN_GLYPH[r.state];
  const started = r.state !== 'pending' && r.runId !== '';
  return {
    run: r,
    glyph: g.glyph,
    tone: g.tone,
    status: runStatus(r),
    note: r.reason || r.note || fixRound(r.loops, max),
    ...returnsChip(r, limit),
    hasLog: started,
    canRetry: started && (r.state === 'failed' || r.state === 'stuck'),
    canResume: r.resumable,
    canReview: r.state === 'review',
  };
}

function showRuns(s: StepProgress, script: boolean): boolean {
  const started = s.runs.some((r) => r.state !== 'pending' || r.note);
  return (
    started &&
    (s.runs.length > 1 ||
      script ||
      s.runs.some((r) => r.state !== s.state || r.note || r.loops > 0))
  );
}

function modeText(stage: Stage): string {
  if (stage.kind === 'agent') return t('space.ade.stage.modeAgent.label');
  if (stage.kind === 'script') return t('common.script.label');
  return stage.session ? t('space.ade.stage.modeUserSession.label') : t('common.user.label');
}

/** One block per workflow stage. Without the workflow file only the current stage is known. */
export function buildStageBlocks(
  i: ProgressInput,
  workflow: Workflow | null,
  current: Stage | null,
  stageIndex: number,
  finished: boolean,
): StageBlock[] {
  const stages: readonly Stage[] = workflow?.stages ?? (current ? [current] : []);
  const idx = finished ? stages.length : workflow ? stageIndex : 0;
  return stages.map((stage, k): StageBlock => {
    const script = stage.kind === 'script';
    const steps = stage.kind === 'user' || (stage.skip && k !== idx) ? [] : buildSteps(i, stage);
    return {
      stage,
      state: stage.skip && k !== idx ? 'skipped' : k < idx ? 'done' : k === idx ? 'now' : 'next',
      steps: steps.map(
        (s): StepView => ({
          step: s,
          statusText: stepStatusText(s),
          tone: STEP_TONE[s.state],
          scope: script ? stage.command : runsOnLabel(s.runsOn),
          gated: s.before === 'approval',
          routeText: routeText(s, stage),
          runs: showRuns(s, script)
            ? s.runs.map((r) => runLine(r, backLimit(steps, s.id), s.maxReturns))
            : [],
        }),
      ),
      count:
        stage.kind === 'agent'
          ? `${steps.filter((s) => s.state === 'done' || s.state === 'skipped').length}/${steps.length}`
          : '',
      mode: modeText(stage),
      release: stage.id === 'release' && k <= idx,
    };
  });
}

/** Stage a skip or Next from `fromId` lands on: the next stage not skipped, else `done`. */
export function nextStageId(blocks: readonly StageBlock[], fromId: string): string {
  const at = blocks.findIndex((b) => b.stage.id === fromId);
  return blocks.slice(at + 1).find((b) => !b.stage.skip)?.stage.id ?? 'done';
}
