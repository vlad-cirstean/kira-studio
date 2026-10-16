import type { Run } from '../wire';
import type { StepBlock } from './stepBlocks';

const DONE_STEP_ID = 'done';

interface StepOption {
  id: string;
  name: string;
  skipped: boolean;
}

export interface StepMoves {
  /** The workflow's steps plus Done, in order. */
  options: StepOption[];
  /** Index of the current step in `options` (0 when unknown). */
  at: number;
  /** The nearest earlier step that is not skipped. */
  prev: StepOption | undefined;
  /** The nearest later step that is not skipped; Done counts. */
  next: StepOption | undefined;
  /** A run of the task is live, so the engine refuses a step move. */
  live: boolean;
}

/** Where a task can go from `stepId`: shared by the desktop step mover and the phone. */
export function stepMoves(
  blocks: readonly StepBlock[],
  stepId: string,
  runs: readonly Pick<Run, 'state'>[],
): StepMoves {
  const options: StepOption[] = [
    ...blocks.map((b) => ({ id: b.step.id, name: b.step.name, skipped: b.state === 'skipped' })),
    { id: DONE_STEP_ID, name: 'Done', skipped: false },
  ];
  const found = options.findIndex((o) => o.id === stepId);
  const at = found < 0 ? 0 : found;
  return {
    options,
    at,
    prev: options.slice(0, at).findLast((o) => !o.skipped),
    next: options.slice(at + 1).find((o) => !o.skipped),
    live: runs.some((r) => r.state === 'running'),
  };
}
