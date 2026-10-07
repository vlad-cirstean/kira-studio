import type { OnFailure, PipelineStep, Stage, StageKind, Workflow } from '../wire';

// Pure helpers behind the Workflows form editor (SPEC2 section 5.1.1). Stage and step ids are run
// keys: they are minted once, here, and never follow a rename.

export const STATUS_OPTIONS: readonly Stage['status'][] = [
  'To do',
  'In progress',
  'In review',
  'Done',
];
export const FAILURE_OPTIONS: readonly OnFailure[] = ['stop', 'retry 1', 'retry 2'];

/** `prefix-<8 hex>`, never in `taken`. Runs are keyed by these ids, so a removed id must not come
 *  back: the lowest free `prefix-N` would hand a new stage or step the old one's runs. */
function nextId(prefix: 'stage' | 'step', taken: readonly string[]): string {
  const used = new Set(taken);
  let id: string;
  do id = `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  while (used.has(id));
  return id;
}

/** A copy of `list` with the item at `index` swapped one place `up` or down; unchanged at the ends. */
export function moved<T>(list: readonly T[], index: number, dir: 'up' | 'down'): T[] {
  const to = dir === 'up' ? index - 1 : index + 1;
  const out = [...list];
  if (to < 0 || to >= out.length) return out;
  const a = out[index] as T;
  out[index] = out[to] as T;
  out[to] = a;
  return out;
}

export function newStep(steps: readonly PipelineStep[]): PipelineStep {
  return {
    id: nextId(
      'step',
      steps.map((s) => s.id),
    ),
    name: 'New step',
    runsOn: 'each repo',
    before: 'auto',
    onFailure: 'stop',
    timeout: '1h',
    prompt: '',
    allowedTools: [],
  };
}

/** The fields a kind owns; every other kind-specific field is cleared (wire comments on `Stage`). */
export function withKind(stage: Stage, kind: StageKind): Stage {
  const base: Stage = {
    ...stage,
    kind,
    session: false,
    prompt: '',
    steps: [],
    command: '',
    runsOn: '',
    onFailure: '',
    timeout: '',
  };
  if (kind === 'script') return { ...base, runsOn: 'each repo', onFailure: 'stop', timeout: '10m' };
  return kind === 'agent' ? { ...base, steps: [newStep([])] } : base;
}

export function newStage(stages: readonly Stage[]): Stage {
  const stage: Stage = {
    id: nextId(
      'stage',
      stages.map((s) => s.id),
    ),
    name: 'New stage',
    kind: 'user',
    status: 'In progress',
    skip: false,
    session: false,
    prompt: '',
    steps: [],
    command: '',
    runsOn: '',
    onFailure: '',
    timeout: '',
  };
  return stage;
}

export function runnableCount(stages: readonly Stage[]): number {
  return stages.filter((s) => !s.skip).length;
}

/** Steps a `back:` can point at from position `index`: the earlier ones. */
export function backOptions(
  steps: readonly PipelineStep[],
  index: number,
): { value: OnFailure; label: string }[] {
  return steps
    .slice(0, index)
    .map((s) => ({ value: `back:${s.id}` as const, label: `↩ send back to ${s.name}` }));
}

/** Resets a `back:` that no longer points at an earlier step (after a move or removal) to `stop`. */
export function withValidBacks(steps: readonly PipelineStep[]): PipelineStep[] {
  return steps.map((s, i) => {
    if (!s.onFailure.startsWith('back:')) return s;
    const target = s.onFailure.slice(5);
    return steps.slice(0, i).some((e) => e.id === target) ? s : { ...s, onFailure: 'stop' };
  });
}

export function parseTools(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function formatTools(tools: readonly string[]): string {
  return tools.join(', ');
}

export function cloneWorkflow(wf: Workflow): Workflow {
  return JSON.parse(JSON.stringify(wf)) as Workflow;
}
