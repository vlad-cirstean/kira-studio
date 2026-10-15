import type { Branch, Task, TaskStatus } from '../wire';
import type { TaskProgress } from './progress';

/** Derived, never stored (D10). `Blocked` is not a workflow status, so it is not on the wire (W8). */
export type DerivedStatus = TaskStatus | 'Blocked';

export interface StatusInput {
  task: Task;
  progress: TaskProgress;
  branches: readonly Branch[];
  /** The task has any session, running or stopped. */
  hasSessions: boolean;
}

/** SPEC2 §5: finished -> Done; stuck/failed run or failed worktree setup -> Blocked; first step with
 *  nothing started -> To do; else the current step's configured status. */
export function deriveStatus(i: StatusInput): DerivedStatus {
  const { task, progress } = i;
  if (task.kind === 'review') return 'In review';
  if (task.kind === 'parked' || !progress.hasWorkflow) return 'To do';
  if (progress.finished) return 'Done';
  if (progress.bad) return 'Blocked';
  if (i.branches.some((b) => b.setup?.state === 'failed')) return 'Blocked';
  const first = progress.steps.findIndex((s) => !s.skip);
  const untouched = progress.steps.every((s) => s.state === 'pending' || s.state === 'skipped');
  if (
    progress.stepIndex === first &&
    progress.stepIndex === progress.entryIndex &&
    !i.hasSessions &&
    untouched
  )
    return 'To do';
  return progress.step?.status || 'In progress';
}
