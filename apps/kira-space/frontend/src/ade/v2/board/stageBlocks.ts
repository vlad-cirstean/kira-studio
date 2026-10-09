import type { Stage, Workflow } from '../wire';
import type { Tone } from './actions';
import {
  buildSteps,
  type ProgressInput,
  type StepProgress,
  type StepRun,
  type StepState,
} from './progress';

// Task panel Workflow block (SPEC2 section 7, mockup `phaseBlocks`): one block per stage, steps with
// their per-repo run lines. Pure, so the card model carries it ready to render.

interface RunLine {
  run: StepRun;
  glyph: string;
  tone: Tone;
  status: string;
  /** The run's own note, else `fix round n of 3` for a fix run. */
  note: string;
  /** Log (agent) / Output (script) opens the run's log: shown once the run started. */
  hasLog: boolean;
  canRetry: boolean;
}

interface StepView {
  step: StepProgress;
  statusText: string;
  tone: Tone;
  /** Agent: the `runsOn` text; script: the command. */
  scope: string;
  gated: boolean;
  failText: string;
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
};

const STEP_TONE: Record<StepState, Tone> = {
  done: 'green',
  running: 'amber',
  stuck: 'red',
  failed: 'red',
  pending: 'grey',
};

function stepStatusText(s: StepProgress): string {
  if (s.state === 'stuck') return 'stuck · needs you';
  if (s.state === 'pending' && s.approval) return 'waiting for approval';
  return s.state;
}

function failText(s: StepProgress, stage: Stage): string {
  const f = s.onFailure;
  if (f.startsWith('back:')) {
    const id = f.slice(5);
    return `↩ on failure: back to ${stage.steps.find((x) => x.id === id)?.name ?? id}`;
  }
  return f && f !== 'stop' ? `on failure: ${f}` : '';
}

function runLine(r: StepRun): RunLine {
  const g = RUN_GLYPH[r.state];
  const started = r.state !== 'pending' && r.runId !== '';
  return {
    run: r,
    glyph: g.glyph,
    tone: g.tone,
    status: r.state === 'done' ? 'done' : r.state === 'back' ? 'sent back' : r.state,
    note: r.reason || r.note || (r.loops ? `fix round ${r.loops} of 3` : ''),
    hasLog: started,
    canRetry: started && (r.state === 'failed' || r.state === 'stuck'),
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
  if (stage.kind === 'agent') return 'agent · background claude -p';
  if (stage.kind === 'script') return 'script';
  return stage.session ? 'user · interactive Claude Code' : 'user';
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
          scope: script ? stage.command : s.runsOn,
          gated: s.before === 'approval',
          failText: failText(s, stage),
          runs: showRuns(s, script) ? s.runs.map(runLine) : [],
        }),
      ),
      count:
        stage.kind === 'agent'
          ? `${steps.filter((s) => s.state === 'done').length}/${steps.length}`
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
