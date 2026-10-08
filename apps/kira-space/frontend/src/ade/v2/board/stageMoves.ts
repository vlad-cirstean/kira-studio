import type { Run } from '../wire';
import type { StageBlock } from './stageBlocks';

const DONE_STAGE_ID = 'done';

interface StageOption {
  id: string;
  name: string;
  skipped: boolean;
}

export interface StageMoves {
  /** The workflow's stages plus Done, in order. */
  options: StageOption[];
  /** Index of the current stage in `options` (0 when unknown). */
  at: number;
  /** The nearest earlier stage that is not skipped. */
  prev: StageOption | undefined;
  /** The nearest later stage that is not skipped; Done counts. */
  next: StageOption | undefined;
  /** A run of the task is live, so the engine refuses a stage move. */
  live: boolean;
}

/** Where a task can go from `stageId`: shared by the desktop stage mover and the phone. */
export function stageMoves(
  blocks: readonly StageBlock[],
  stageId: string,
  runs: readonly Pick<Run, 'state'>[],
): StageMoves {
  const options: StageOption[] = [
    ...blocks.map((b) => ({ id: b.stage.id, name: b.stage.name, skipped: b.state === 'skipped' })),
    { id: DONE_STAGE_ID, name: 'Done', skipped: false },
  ];
  const found = options.findIndex((o) => o.id === stageId);
  const at = found < 0 ? 0 : found;
  return {
    options,
    at,
    prev: options.slice(0, at).findLast((o) => !o.skipped),
    next: options.slice(at + 1).find((o) => !o.skipped),
    live: runs.some((r) => r.state === 'running'),
  };
}
