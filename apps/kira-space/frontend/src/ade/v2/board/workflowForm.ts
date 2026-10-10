import type { OnFailure, PipelineStep, Stage, StageKind, Workflow } from '../wire';
import { implicitResults } from './stepResults';

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

export function newStep(steps: readonly PipelineStep[]): PipelineStep {
  const id = nextId(
    'step',
    steps.map((s) => s.id),
  );
  return {
    id,
    results: implicitResults(id, 'stop'),
    name: 'New step',
    runsOn: 'each repo',
    before: 'auto',
    onFailure: 'stop',
    timeout: '1h',
    prompt: '',
    allowedTools: [],
    smartScript: '',
    params: {},
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
